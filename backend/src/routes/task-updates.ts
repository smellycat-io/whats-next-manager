import { Router } from "express";
import { randomUUID } from "crypto";
import { TableItem, getItem, putItem, queryByPk, updateItem, userPk } from "../db/client";
import { sortKeys } from "../db/keys";
import { badRequest, notFound } from "../http/errors";
import { assertOneOf, bodyOf } from "../http/request-body";

/**
 * A task's progress log (TASK_UPDATE items) — see AGENT-WORKERS.md.
 * Mounted inside tasksRouter, so requireUserId has already run.
 */
export const taskUpdatesRouter = Router();

const TASK_UPDATE_KINDS = ["progress", "result", "error"] as const;

interface TaskUpdateFields {
  kind: (typeof TASK_UPDATE_KINDS)[number];
  text: string;
}

function toTaskUpdate(item: TableItem) {
  return {
    id: sortKeys.taskUpdate.idOf(item),
    taskId: item.taskId,
    kind: item.kind,
    text: item.text,
    actorUserId: item.actorUserId,
    createdAt: item.createdAt,
  };
}

/** Sort-key prefix shared by one task's updates, which sort by time. */
function updatesPrefixFor(taskId: string): string {
  return sortKeys.taskUpdate.for(`${taskId}#`);
}

taskUpdatesRouter.get("/:id/updates", async (req, res) => {
  const items = await queryByPk(userPk(req.userId), updatesPrefixFor(req.params.id));
  res.json(items.map(toTaskUpdate));
});

taskUpdatesRouter.post("/:id/updates", async (req, res) => {
  const { kind, text } = bodyOf<TaskUpdateFields>(req.body);
  if (!kind || !text) throw badRequest("kind and text are required");
  assertOneOf(kind, TASK_UPDATE_KINDS, "kind");

  const pk = userPk(req.userId);
  const taskSk = sortKeys.task.for(req.params.id);
  if (!(await getItem(pk, taskSk))) throw notFound("Task");

  const now = new Date().toISOString();
  const item: TableItem = {
    pk,
    // The random suffix keeps two updates in the same millisecond apart.
    sk: `${updatesPrefixFor(req.params.id)}${now}#${randomUUID().slice(0, 8)}`,
    type: "TASK_UPDATE",
    taskId: req.params.id,
    kind,
    text,
    actorUserId: req.actorUserId,
    createdAt: now,
  };
  await putItem(item);
  // Bumps the task so clients polling with updatedSince see new progress.
  await updateItem(pk, taskSk, { updatedAt: now });
  res.status(201).json(toTaskUpdate(item));
});
