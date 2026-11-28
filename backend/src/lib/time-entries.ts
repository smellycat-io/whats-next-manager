import { TableItem } from "../db/client";
import { sortKeys } from "../db/keys";
import { ContractSnapshot } from "./contracts";

/**
 * One entity covers human hours and agent runs, so both flow through the
 * same reports and invoices — see CLIENTS-INVOICING.md.
 */
export const ACTOR_TYPES = ["human", "agent"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const PROVIDERS = ["anthropic", "ollama"] as const;
export const COST_TYPES = ["paid", "local"] as const;
/**
 * `api-equivalent`: what the run would cost at API prices, for runs covered
 * by a subscription. `actual`: what was really charged.
 */
export const COST_BASES = ["api-equivalent", "actual"] as const;
export const TOKEN_COUNT_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
] as const;

export interface TimeEntryFields {
  projectId: string;
  taskId: string;
  date: string;
  hours: number;
  billable: boolean;
  notes: string;
  actorType: ActorType;
  provider: (typeof PROVIDERS)[number];
  model: string;
  costType: (typeof COST_TYPES)[number];
  costBasis: (typeof COST_BASES)[number];
  agentRunId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/** An entry already on an invoice can't be edited or deleted. */
export function isInvoiced(entry: TableItem): boolean {
  return ((entry.invoicedContractIds as string[] | undefined) ?? []).length > 0;
}

export function toTimeEntry(item: TableItem) {
  const base = {
    id: sortKeys.timeEntry.idOf(item),
    projectId: item.projectId,
    taskId: item.taskId ?? null,
    date: item.date,
    hours: item.hours,
    billable: item.billable ?? true,
    notes: item.notes ?? null,
    actorType: item.actorType ?? "human",
    contractSnapshots: (item.contractSnapshots as ContractSnapshot[] | undefined) ?? [],
    invoicedContractIds: (item.invoicedContractIds as string[] | undefined) ?? [],
    createdAt: item.createdAt ?? null,
    createdBy: item.createdBy ?? null,
  };
  if (base.actorType !== "agent") return base;
  return {
    ...base,
    provider: item.provider,
    model: item.model,
    costType: item.costType,
    costBasis: item.costBasis,
    agentRunId: item.agentRunId ?? null,
    inputTokens: item.inputTokens ?? 0,
    outputTokens: item.outputTokens ?? 0,
    cacheReadTokens: item.cacheReadTokens ?? 0,
    cacheWriteTokens: item.cacheWriteTokens ?? 0,
    costUsd: item.costUsd ?? 0,
  };
}
