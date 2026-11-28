import { TableItem } from "../db/client";
import { sortKeys } from "../db/keys";

/**
 * `Unsorted` holds tasks that haven't been sorted into an Area or project
 * yet; the dispatcher moves them out (see AGENT-WORKERS.md).
 */
export const TASK_STATUSES = ["Unsorted", "Backlog", "To Do", "In Progress", "Done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Machine progress for agent work, separate from `status` so the Kanban
 * stays meaningful to a human. Absent means the task isn't agent work.
 * `claimed` is only ever set by the claim endpoint.
 */
export const AGENT_STATES = ["queued", "claimed", "running", "needs_review", "done", "failed"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export const TASK_SOURCES = ["phone", "web", "agent"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

export interface Subtask {
  id: string;
  name: string;
  completed: boolean;
}

export interface TaskFields {
  name: string;
  description: string;
  deadline: string;
  projectId: string;
  areaIds: string[];
  priorityLevelId: string;
  status: TaskStatus;
  completed: boolean;
  subtasks: Subtask[];
  assignedToUserId: string;
  source: TaskSource;
  agentState: AgentState;
}

/** Sort-key prefix shared by one task's TASK_UPDATE items, which sort by time. */
export function taskUpdatesPrefix(taskId: string): string {
  return sortKeys.taskUpdate.for(`${taskId}#`);
}

/** A new task with no Area or project hasn't been sorted yet. */
export function defaultStatusFor(task: Partial<TaskFields>): TaskStatus {
  return (task.areaIds?.length ?? 0) > 0 || task.projectId ? "Backlog" : "Unsorted";
}

export function toTask(item: TableItem) {
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
    source: item.source ?? null,
    createdAt: item.createdAt ?? null,
    updatedAt: item.updatedAt ?? null,
    createdBy: item.createdBy ?? null,
    agentState: item.agentState ?? null,
    agentClaimedBy: item.agentClaimedBy ?? null,
    agentClaimedAt: item.agentClaimedAt ?? null,
    agentHeartbeatAt: item.agentHeartbeatAt ?? null,
  };
}
