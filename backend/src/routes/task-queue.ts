import { Router } from "express";
import { getItem, updateItem, userPk } from "../db/client";
import { sortKeys } from "../db/keys";
import { HttpError, badRequest, conflict, notFound } from "../http/errors";
import { bodyOf } from "../http/request-body";
import { toTask } from "../lib/tasks";

/**
 * Claiming and heartbeats for agent workers — see AGENT-WORKERS.md.
 * Mounted inside tasksRouter, so requireUserId has already run.
 */
export const taskQueueRouter = Router();

interface WorkerFields {
  workerId: string;
}

function requireWorkerId(body: unknown): string {
  const { workerId } = bodyOf<WorkerFields>(body);
  if (!workerId) throw badRequest("workerId is required");
  return workerId;
}

/** Why a conditional task update didn't apply: no such task, or its state changed. */
async function notFoundOrConflict(pk: string, sk: string, conflictMessage: string): Promise<HttpError> {
  return (await getItem(pk, sk)) ? conflict(conflictMessage) : notFound("Task");
}

// Only succeeds while the task is still queued, so two workers can't take
// the same task.
taskQueueRouter.post("/:id/claim", async (req, res) => {
  const workerId = requireWorkerId(req.body);
  const pk = userPk(req.userId);
  const sk = sortKeys.task.for(req.params.id);
  const now = new Date().toISOString();

  const claimed = await updateItem(
    pk,
    sk,
    {
      agentState: "claimed",
      agentClaimedBy: workerId,
      agentClaimedAt: now,
      agentHeartbeatAt: now,
      updatedAt: now,
    },
    { agentState: "queued" },
  );
  if (!claimed) throw await notFoundOrConflict(pk, sk, "Task is not queued");
  res.json(toTask(claimed));
});

// Only the worker holding the claim can extend it. The dispatcher requeues
// tasks whose heartbeat goes stale.
taskQueueRouter.post("/:id/heartbeat", async (req, res) => {
  const workerId = requireWorkerId(req.body);
  const pk = userPk(req.userId);
  const sk = sortKeys.task.for(req.params.id);
  const now = new Date().toISOString();

  const updated = await updateItem(
    pk,
    sk,
    { agentHeartbeatAt: now, updatedAt: now },
    { agentClaimedBy: workerId },
  );
  if (!updated) throw await notFoundOrConflict(pk, sk, "Task is not claimed by this worker");
  res.json(toTask(updated));
});
