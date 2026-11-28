import { Router } from "express";
import { randomUUID } from "crypto";
import { requireUserId } from "../auth/current-user";
import {
  TableItem,
  deleteItem,
  getItem,
  putItem,
  queryByPk,
  updateItem,
  userPk,
} from "../db/client";
import { sortKeys } from "../db/keys";
import { badRequest, notFound } from "../http/errors";
import { assertOneOf, bodyOf, pickDefinedFields } from "../http/request-body";
import { assertAtMostOneWorkArea } from "../lib/areas";
import { resolveHighestUrgencyPriorityLevelId } from "../lib/priority-resolution";
import {
  AGENT_STATES,
  TASK_SOURCES,
  TASK_STATUSES,
  TaskFields,
  defaultStatusFor,
  taskUpdatesPrefix,
  toTask,
} from "../lib/tasks";
import { taskQueueRouter } from "./task-queue";
import { taskUpdatesRouter } from "./task-updates";

const UPDATABLE_FIELDS = [
  "name",
  "description",
  "deadline",
  "projectId",
  "areaIds",
  "priorityLevelId",
  "status",
  "completed",
  "subtasks",
  "assignedToUserId",
  "agentState",
] as const satisfies readonly (keyof TaskFields)[];

const CLAIM_ONLY_MESSAGE = "agentState claimed is set by POST /tasks/:id/claim";

/** Validates the enum fields a create or update may carry. */
function assertValidTaskFields(body: Partial<TaskFields>): void {
  assertOneOf(body.status, TASK_STATUSES, "status");
  assertOneOf(body.agentState, AGENT_STATES, "agentState");
  assertOneOf(body.source, TASK_SOURCES, "source");
  if (body.agentState === "claimed") throw badRequest(CLAIM_ONLY_MESSAGE);
}

/**
 * ARCHITECTURE.md's "Default priority resolution": a task's effective
 * Area tags are its own if set, otherwise its project's — then the
 * highest-urgency level among those tags is the default priorityLevelId.
 * Only used at creation time when priorityLevelId is omitted; once set
 * (even by this resolution), it's a manual value a later PUT can
 * override but that a later PUT will never silently recompute.
 */
async function resolveDefaultPriorityLevelId(
  userId: string,
  task: Partial<TaskFields>,
): Promise<string | undefined> {
  let effectiveAreaIds = task.areaIds;
  if ((!effectiveAreaIds || effectiveAreaIds.length === 0) && task.projectId) {
    const project = await getItem(userPk(userId), sortKeys.project.for(task.projectId));
    effectiveAreaIds = (project?.areaIds as string[] | undefined) ?? [];
  }
  return resolveHighestUrgencyPriorityLevelId(userId, effectiveAreaIds ?? []);
}

interface TaskListFilters {
  status?: string;
  agentState?: string;
  updatedSince?: string;
}

/**
 * Filters applied in the Lambda over the user's task items — cheap at
 * personal scale, and avoids adding an index (see AGENT-WORKERS.md).
 */
function matchesFilters(item: TableItem, filters: TaskListFilters): boolean {
  return (
    (filters.status === undefined || item.status === filters.status) &&
    (filters.agentState === undefined || item.agentState === filters.agentState) &&
    (filters.updatedSince === undefined ||
      (typeof item.updatedAt === "string" && item.updatedAt > filters.updatedSince))
  );
}

export const tasksRouter = Router();
tasksRouter.use(requireUserId);
tasksRouter.use(taskQueueRouter);
tasksRouter.use(taskUpdatesRouter);

tasksRouter.get("/", async (req, res) => {
  const filters = req.query as TaskListFilters;
  const items = await queryByPk(userPk(req.userId), sortKeys.task.prefix);
  res.json(items.filter((item) => matchesFilters(item, filters)).map(toTask));
});

tasksRouter.post("/", async (req, res) => {
  const body = bodyOf<TaskFields>(req.body);
  if (!body.name) throw badRequest("name is required");
  assertValidTaskFields(body);
  await assertAtMostOneWorkArea(req.userId, body.areaIds ?? []);

  const priorityLevelId =
    body.priorityLevelId ??
    (await resolveDefaultPriorityLevelId(req.userId, body));
  const isDelegated = req.actorUserId !== req.userId;
  const now = new Date().toISOString();

  const item: TableItem = {
    pk: userPk(req.userId),
    sk: sortKeys.task.for(randomUUID()),
    type: "TASK",
    projectId: body.projectId,
    name: body.name,
    description: body.description,
    deadline: body.deadline,
    priorityLevelId,
    areaIds: body.areaIds ?? [],
    status: body.status ?? defaultStatusFor(body),
    completed: body.completed ?? false,
    subtasks: body.subtasks ?? [],
    assignedToUserId: body.assignedToUserId,
    // An agent can't pass its tasks off as the user's own.
    source: isDelegated ? "agent" : body.source,
    agentState: body.agentState,
    createdAt: now,
    updatedAt: now,
    createdBy: req.actorUserId,
  };
  await putItem(item);
  res.status(201).json(toTask(item));
});

tasksRouter.put("/:id", async (req, res) => {
  const body = bodyOf<TaskFields>(req.body);
  assertValidTaskFields(body);
  const updates = pickDefinedFields(body, UPDATABLE_FIELDS);
  if (updates.areaIds) await assertAtMostOneWorkArea(req.userId, updates.areaIds as string[]);

  // Requeueing (e.g. after a stale heartbeat) releases the old claim.
  if (body.agentState === "queued") {
    Object.assign(updates, { agentClaimedBy: null, agentClaimedAt: null, agentHeartbeatAt: null });
  }
  updates.updatedAt = new Date().toISOString();

  const updated = await updateItem(userPk(req.userId), sortKeys.task.for(req.params.id), updates);
  if (!updated) throw notFound("Task");
  res.json(toTask(updated));
});

// Deletes the task's progress log with it, so no TASK_UPDATE items are
// left behind for a task that no longer exists.
tasksRouter.delete("/:id", async (req, res) => {
  const pk = userPk(req.userId);
  const deleted = await deleteItem(pk, sortKeys.task.for(req.params.id));
  if (!deleted) throw notFound("Task");

  const updates = await queryByPk(pk, taskUpdatesPrefix(req.params.id));
  await Promise.all(updates.map((update) => deleteItem(pk, update.sk)));
  res.status(204).send();
});
