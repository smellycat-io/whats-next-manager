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
import { badRequest, notFound } from "../http/errors";
import { bodyOf, pickDefinedFields } from "../http/request-body";
import { resolveHighestUrgencyPriorityLevelId } from "../lib/priority-resolution";
import { SK_PREFIX as PROJECT_SK_PREFIX } from "./projects";

const SK_PREFIX = "TASK#";

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
  lifeAreaIds?: string[];
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
  "lifeAreaIds",
  "priorityLevelId",
  "status",
  "completed",
  "subtasks",
  "assignedToUserId",
] as const satisfies readonly (keyof TaskFields)[];

function skFor(id: string): string {
  return `${SK_PREFIX}${id}`;
}

function toTask(item: TableItem) {
  return {
    id: (item.sk as string).slice(SK_PREFIX.length),
    projectId: item.projectId ?? null,
    name: item.name,
    description: item.description ?? null,
    deadline: item.deadline ?? null,
    priorityLevelId: item.priorityLevelId ?? null,
    lifeAreaIds: (item.lifeAreaIds as string[] | undefined) ?? [],
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
 * Life Area tags are its own if set, otherwise its project's — then the
 * highest-urgency level among those tags is the default priorityLevelId.
 * Only used at creation time when priorityLevelId is omitted; once set
 * (even by this resolution), it's a manual value a later PUT can
 * override but that a later PUT will never silently recompute.
 */
async function resolveDefaultPriorityLevelId(
  userId: string,
  task: Pick<TaskFields, "lifeAreaIds" | "projectId">,
): Promise<string | undefined> {
  let effectiveLifeAreaIds = task.lifeAreaIds;
  if ((!effectiveLifeAreaIds || effectiveLifeAreaIds.length === 0) && task.projectId) {
    const project = await getItem(
      userPk(userId),
      `${PROJECT_SK_PREFIX}${task.projectId}`,
    );
    effectiveLifeAreaIds = (project?.lifeAreaIds as string[] | undefined) ?? [];
  }
  return resolveHighestUrgencyPriorityLevelId(userId, effectiveLifeAreaIds ?? []);
}

export const tasksRouter = Router();
tasksRouter.use(requireUserId);

tasksRouter.get("/", async (req, res) => {
  const items = await queryByPk(userPk(req.userId), SK_PREFIX);
  res.json(items.map(toTask));
});

tasksRouter.post("/", async (req, res) => {
  const body = bodyOf<TaskFields>(req.body);
  if (!body.name) throw badRequest("name is required");

  const priorityLevelId =
    body.priorityLevelId ??
    (await resolveDefaultPriorityLevelId(req.userId, body));

  const item: TableItem = {
    pk: userPk(req.userId),
    sk: skFor(randomUUID()),
    type: "TASK",
    projectId: body.projectId,
    name: body.name,
    description: body.description,
    deadline: body.deadline,
    priorityLevelId,
    lifeAreaIds: body.lifeAreaIds ?? [],
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
  const updated = await updateItem(userPk(req.userId), skFor(req.params.id), updates);
  if (!updated) throw notFound("Task");
  res.json(toTask(updated));
});

tasksRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteItem(userPk(req.userId), skFor(req.params.id));
  if (!deleted) throw notFound("Task");
  res.status(204).send();
});
