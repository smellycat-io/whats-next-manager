import { TableItem } from "../db/client";
import { sortKeys } from "../db/keys";
import { Contract, ContractSnapshot, toContract } from "./contracts";

/**
 * Usage and billing math over time entries — see CLIENTS-INVOICING.md.
 * Pure functions: callers load the entries, contracts and projects.
 */

export interface DateRange {
  from: string;
  to: string;
}

interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface UsageTotals {
  humanHours: number;
  billableHumanHours: number;
  agentHours: number;
  paidCostUsd: number;
  localCostUsd: number;
  tokensByModel: Record<string, TokenCounts>;
}

function emptyTotals(): UsageTotals {
  return {
    humanHours: 0,
    billableHumanHours: 0,
    agentHours: 0,
    paidCostUsd: 0,
    localCostUsd: 0,
    tokensByModel: {},
  };
}

const numberOf = (value: unknown): number => (typeof value === "number" ? value : 0);
const isAgentEntry = (entry: TableItem) => entry.actorType === "agent";
const isBillable = (entry: TableItem) => entry.billable !== false;

/** Rounds money to cents and hours to hundredths, so sums of floats read cleanly. */
const roundTo2 = (value: number) => Math.round(value * 100) / 100;

function addEntry(totals: UsageTotals, entry: TableItem): void {
  const hours = numberOf(entry.hours);
  if (!isAgentEntry(entry)) {
    totals.humanHours += hours;
    if (isBillable(entry)) totals.billableHumanHours += hours;
    return;
  }

  totals.agentHours += hours;
  const costUsd = numberOf(entry.costUsd);
  if (entry.costType === "paid") totals.paidCostUsd += costUsd;
  else totals.localCostUsd += costUsd;

  const model = String(entry.model);
  const counts = (totals.tokensByModel[model] ??= {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  counts.inputTokens += numberOf(entry.inputTokens);
  counts.outputTokens += numberOf(entry.outputTokens);
  counts.cacheReadTokens += numberOf(entry.cacheReadTokens);
  counts.cacheWriteTokens += numberOf(entry.cacheWriteTokens);
}

export function summarize(entries: TableItem[]): UsageTotals {
  const totals = emptyTotals();
  entries.forEach((entry) => addEntry(totals, entry));
  return {
    ...totals,
    humanHours: roundTo2(totals.humanHours),
    billableHumanHours: roundTo2(totals.billableHumanHours),
    agentHours: roundTo2(totals.agentHours),
    paidCostUsd: roundTo2(totals.paidCostUsd),
    localCostUsd: roundTo2(totals.localCostUsd),
  };
}

/** Totals per project, for the projects that have entries. */
export function summarizeByProject(entries: TableItem[], projects: TableItem[]) {
  return projects
    .map((project) => {
      const projectId = sortKeys.project.idOf(project);
      const projectEntries = entries.filter((entry) => entry.projectId === projectId);
      return { projectId, name: project.name, entries: projectEntries };
    })
    .filter(({ entries: projectEntries }) => projectEntries.length > 0)
    .map(({ projectId, name, entries: projectEntries }) => ({
      projectId,
      name,
      totals: summarize(projectEntries),
    }));
}

function snapshotFor(entry: TableItem, contractId: string): ContractSnapshot | undefined {
  return ((entry.contractSnapshots as ContractSnapshot[] | undefined) ?? []).find(
    (snapshot) => snapshot.contractId === contractId,
  );
}

/** Calendar months (YYYY-MM) touched by a date range, both ends inclusive. */
function monthsTouched(from: string, to: string): number {
  if (from > to) return 0;
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
}

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/**
 * The fixed part of a contract's bill for a range: a flat fee per month
 * the range and contract share (a partial month counts as a full one), or
 * a one-time or per-project fee when the contract starts inside the range.
 */
function feeFor(terms: Contract, range: DateRange): number {
  if (terms.payUnit === "hourly") return 0;
  const startsInRange = range.from <= terms.startDate && terms.startDate <= range.to;
  if (terms.payUnit === "per-project") return startsInRange ? terms.rate * terms.projectIds.length : 0;
  if (terms.flatRatePeriod === "one-time") return startsInRange ? terms.rate : 0;

  const sharedFrom = later(range.from, terms.startDate);
  const sharedTo = earlier(range.to, terms.endDate ?? range.to);
  return terms.rate * monthsTouched(sharedFrom, sharedTo);
}

/**
 * What a contract bills for a range. Hourly and token amounts use each
 * entry's snapshot of the terms; the fixed fee uses the contract as it
 * stands. For flat contracts, also the effective hourly rate the fee
 * works out to once token cost is taken out — the reasonableness check.
 */
export function billUnderContract(contract: TableItem, entries: TableItem[], range: DateRange) {
  const terms = toContract(contract);
  const covered = entries
    .map((entry) => ({ entry, snapshot: snapshotFor(entry, terms.id) }))
    .filter((pair): pair is { entry: TableItem; snapshot: ContractSnapshot } => pair.snapshot !== undefined);

  let hoursAmount = 0;
  let tokenCostUsd = 0;
  let tokenAmount = 0;
  for (const { entry, snapshot } of covered) {
    if (isAgentEntry(entry)) {
      const cost = numberOf(entry.costUsd);
      tokenCostUsd += cost;
      if (isBillable(entry) && snapshot.tokenBilling === "passthrough") {
        tokenAmount += cost * numberOf(snapshot.tokenMarkup);
      }
    } else if (isBillable(entry) && snapshot.payUnit === "hourly") {
      hoursAmount += numberOf(entry.hours) * numberOf(snapshot.rate);
    }
  }

  const fee = feeFor(terms, range);
  const totals = summarize(covered.map(({ entry }) => entry));
  return {
    contractId: terms.id,
    issuerAreaId: terms.issuerAreaId,
    clientId: terms.clientId,
    billingMode: terms.billingMode,
    payUnit: terms.payUnit,
    hoursAmount: roundTo2(hoursAmount),
    feeAmount: roundTo2(fee),
    tokenCostUsd: roundTo2(tokenCostUsd),
    tokenAmount: roundTo2(tokenAmount),
    totalAmount: roundTo2(hoursAmount + fee + tokenAmount),
    humanHours: totals.humanHours,
    effectiveHourlyRate:
      terms.payUnit === "flat" && totals.humanHours > 0
        ? roundTo2((fee - tokenCostUsd) / totals.humanHours)
        : null,
  };
}
