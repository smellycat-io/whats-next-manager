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
import { badRequest, conflict, notFound } from "../http/errors";
import {
  assertIsoDate,
  assertNonNegativeNumber,
  assertOneOf,
  bodyOf,
  pickDefinedFields,
} from "../http/request-body";
import { contractsCovering, snapshotOf } from "../lib/contracts";
import {
  ACTOR_TYPES,
  COST_BASES,
  COST_TYPES,
  PROVIDERS,
  TOKEN_COUNT_FIELDS,
  TimeEntryFields,
  isInvoiced,
  toTimeEntry,
} from "../lib/time-entries";

const EDITABLE_FIELDS = ["taskId", "date", "hours", "billable", "notes"] as const satisfies readonly (keyof TimeEntryFields)[];

const INVOICED_MESSAGE = "Entry is on an invoice and can't be changed";

/** The agent-run fields an agent entry stores, validated — see CLIENTS-INVOICING.md. */
function agentRunFields(body: Partial<TimeEntryFields>): Record<string, unknown> {
  const { provider, model, costType } = body;
  if (!provider || !model || !costType) {
    throw badRequest("provider, model and costType are required for agent entries");
  }
  assertOneOf(provider, PROVIDERS, "provider");
  assertOneOf(costType, COST_TYPES, "costType");
  assertOneOf(body.costBasis, COST_BASES, "costBasis");
  if (costType === "paid" && !body.costBasis) {
    throw badRequest("costBasis is required for paid agent entries");
  }
  assertNonNegativeNumber(body.costUsd, "costUsd");
  for (const field of TOKEN_COUNT_FIELDS) assertNonNegativeNumber(body[field], field);

  return {
    provider,
    model,
    costType,
    // A local run costs nothing, so its cost of 0 is actual, not estimated.
    costBasis: body.costBasis ?? "actual",
    agentRunId: body.agentRunId,
    costUsd: body.costUsd ?? 0,
    ...Object.fromEntries(TOKEN_COUNT_FIELDS.map((field) => [field, body[field] ?? 0])),
  };
}

/** Rejects a projectId or taskId that doesn't match an item. */
async function assertWorkTargetsExist(userId: string, projectId: string, taskId?: string): Promise<void> {
  const pk = userPk(userId);
  const [project, task] = await Promise.all([
    getItem(pk, sortKeys.project.for(projectId)),
    taskId ? getItem(pk, sortKeys.task.for(taskId)) : undefined,
  ]);
  if (!project) throw badRequest("projectId does not match a project");
  if (taskId && !task) throw badRequest("taskId does not match a task");
}

/** Captures the terms of every contract covering this work, at the moment it's logged. */
async function contractSnapshotsFor(userId: string, projectId: string, date: string) {
  return (await contractsCovering(userId, projectId, date)).map(snapshotOf);
}

interface TimeEntryListFilters {
  projectId?: string;
  actorType?: string;
  from?: string;
  to?: string;
}

function matchesFilters(entry: TableItem, filters: TimeEntryListFilters): boolean {
  const date = entry.date as string;
  return (
    (filters.projectId === undefined || entry.projectId === filters.projectId) &&
    (filters.actorType === undefined || (entry.actorType ?? "human") === filters.actorType) &&
    (filters.from === undefined || date >= filters.from) &&
    (filters.to === undefined || date <= filters.to)
  );
}

export const timeEntriesRouter = Router();
timeEntriesRouter.use(requireUserId);

timeEntriesRouter.get("/", async (req, res) => {
  const filters = req.query as TimeEntryListFilters;
  const items = await queryByPk(userPk(req.userId), sortKeys.timeEntry.prefix);
  res.json(items.filter((item) => matchesFilters(item, filters)).map(toTimeEntry));
});

timeEntriesRouter.post("/", async (req, res) => {
  const body = bodyOf<TimeEntryFields>(req.body);
  const { projectId, date, hours } = body;
  if (!projectId || !date || hours === undefined) {
    throw badRequest("projectId, date and hours are required");
  }
  assertIsoDate(date, "date");
  assertNonNegativeNumber(hours, "hours");
  assertOneOf(body.actorType, ACTOR_TYPES, "actorType");
  await assertWorkTargetsExist(req.userId, projectId, body.taskId);

  // A delegate's entries are always agent runs.
  const actorType = req.actorUserId !== req.userId ? "agent" : (body.actorType ?? "human");
  const now = new Date().toISOString();

  const item: TableItem = {
    pk: userPk(req.userId),
    sk: sortKeys.timeEntry.for(randomUUID()),
    type: "TIME_ENTRY",
    projectId,
    taskId: body.taskId,
    date,
    hours,
    billable: body.billable ?? true,
    notes: body.notes,
    actorType,
    ...(actorType === "agent" ? agentRunFields(body) : {}),
    contractSnapshots: await contractSnapshotsFor(req.userId, projectId, date),
    invoicedContractIds: [],
    createdAt: now,
    createdBy: req.actorUserId,
  };
  await putItem(item);
  res.status(201).json(toTimeEntry(item));
});

// Only the logging details are editable. Changing the date re-captures
// which contracts cover the work.
timeEntriesRouter.put("/:id", async (req, res) => {
  const pk = userPk(req.userId);
  const sk = sortKeys.timeEntry.for(req.params.id);
  const existing = await getItem(pk, sk);
  if (!existing) throw notFound("Time entry");
  if (isInvoiced(existing)) throw conflict(INVOICED_MESSAGE);

  const body = bodyOf<TimeEntryFields>(req.body);
  assertIsoDate(body.date, "date");
  assertNonNegativeNumber(body.hours, "hours");
  if (body.taskId) await assertWorkTargetsExist(req.userId, existing.projectId as string, body.taskId);

  const updates = pickDefinedFields(body, EDITABLE_FIELDS);
  if (body.date && body.date !== existing.date) {
    updates.contractSnapshots = await contractSnapshotsFor(
      req.userId,
      existing.projectId as string,
      body.date,
    );
  }

  const updated = await updateItem(pk, sk, updates);
  if (!updated) throw notFound("Time entry");
  res.json(toTimeEntry(updated));
});

timeEntriesRouter.delete("/:id", async (req, res) => {
  const pk = userPk(req.userId);
  const sk = sortKeys.timeEntry.for(req.params.id);
  const existing = await getItem(pk, sk);
  if (!existing) throw notFound("Time entry");
  if (isInvoiced(existing)) throw conflict(INVOICED_MESSAGE);
  await deleteItem(pk, sk);
  res.status(204).send();
});
