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
import { bodyOf, pickDefinedFields } from "../http/request-body";
import { assertAtMostOneWorkArea } from "../lib/areas";
import { resolveHighestUrgencyPriorityLevelId } from "../lib/priority-resolution";

type TaskStatus = "Backlog" | "To Do" | "In Progress" | "Done";

interface Subtask {
  id: string;
  name: string;
  completed: boolean;
}

interface TaskFields {
  name?: string;
  description?: string;
  deadline?: string;
  projectId?: string;
  areaIds?: string[];
  priorityLevelId?: string;
  status?: TaskStatus;
  completed?: boolean;
  subtasks?: Subtask[];
  assignedToUserId?: string;
}

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
] as const satisfies readonly (keyof TaskFields)[];

function toTask(item: TableItem) {
  return {
    id: sortKeys.task.idOf(item),
    projectId: item.projectId ?? null,
    name: item.name,
    description: item.description ?? null,
    deadline: item.deadline ?? null,
    priorityLevelId: item.priorityLevelId ?? null,
    areaIds: (item.areaIds as string[] | undefined) ?? [],
    status: (item.status as TaskStatus | undefined) ?? "Backlog",
    completed: item.completed ?? false,
    subtasks: (item.subtasks as Subtask[] | undefined) ?? [],
    // Never set yet — Google Calendar integration isn't built (see
    // ARCHITECTURE.md Task -> Calendar sync). Field exists so the shape
    // doesn't need to change when that lands.
    linkedCalendarEventId: item.linkedCalendarEventId ?? null,
    assignedToUserId: item.assignedToUserId ?? null,
  };
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
  task: Pick<TaskFields, "areaIds" | "projectId">,
): Promise<string | undefined> {
  let effectiveAreaIds = task.areaIds;
  if ((!effectiveAreaIds || effectiveAreaIds.length === 0) && task.projectId) {
    const project = await getItem(userPk(userId), sortKeys.project.for(task.projectId));
    effectiveAreaIds = (project?.areaIds as string[] | undefined) ?? [];
  }
  return resolveHighestUrgencyPriorityLevelId(userId, effectiveAreaIds ?? []);
}

export const tasksRouter = Router();
tasksRouter.use(requireUserId);

tasksRouter.get("/", async (req, res) => {
  const items = await queryByPk(userPk(req.userId), sortKeys.task.prefix);
  res.json(items.map(toTask));
});

tasksRouter.post("/", async (req, res) => {
  const body = bodyOf<TaskFields>(req.body);
  if (!body.name) throw badRequest("name is required");
  await assertAtMostOneWorkArea(req.userId, body.areaIds ?? []);

  const priorityLevelId =
    body.priorityLevelId ??
    (await resolveDefaultPriorityLevelId(req.userId, body));

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
    status: body.status ?? "Backlog",
    completed: body.completed ?? false,
    subtasks: body.subtasks ?? [],
    assignedToUserId: body.assignedToUserId,
  };
  await putItem(item);
  res.status(201).json(toTask(item));
});

tasksRouter.put("/:id", async (req, res) => {
  const updates = pickDefinedFields(bodyOf<TaskFields>(req.body), UPDATABLE_FIELDS);
  if (updates.areaIds) await assertAtMostOneWorkArea(req.userId, updates.areaIds as string[]);
  const updated = await updateItem(userPk(req.userId), sortKeys.task.for(req.params.id), updates);
  if (!updated) throw notFound("Task");
  res.json(toTask(updated));
});

tasksRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteItem(userPk(req.userId), sortKeys.task.for(req.params.id));
  if (!deleted) throw notFound("Task");
  res.status(204).send();
});
