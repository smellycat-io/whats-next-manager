import { TableItem } from "../db/client";
import { PROVIDERS } from "./time-entries";

/**
 * Token budgets against subscription limits that reset on rolling
 * windows — see AGENT-WORKERS.md. Pure functions over agent entries.
 */
export const BUDGET_WINDOWS = ["rolling-hours", "weekly"] as const;
export const DEFAULT_BUDGET_RESERVE_PERCENT = 20;

const HOURS_PER_WEEK = 7 * 24;

export interface TokenBudget {
  provider: (typeof PROVIDERS)[number];
  window: (typeof BUDGET_WINDOWS)[number];
  windowHours?: number;
  limitTokens: number;
}

/**
 * The tokens an entry counts against a budget: paid usage only, without
 * cache reads, which dwarf the other counts and don't track the limit.
 */
export function budgetTokensOf(entry: TableItem): number {
  if (entry.actorType !== "agent" || entry.costType !== "paid") return 0;
  return [entry.inputTokens, entry.outputTokens, entry.cacheWriteTokens]
    .map((count) => (typeof count === "number" ? count : 0))
    .reduce((sum, count) => sum + count, 0);
}

function windowStart(budget: TokenBudget, now: Date): string {
  const hours = budget.window === "weekly" ? HOURS_PER_WEEK : (budget.windowHours ?? 0);
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

/** The entries logged inside a budget's current window, for its provider. */
export function entriesInWindow(budget: TokenBudget, entries: TableItem[], now: Date): TableItem[] {
  const since = windowStart(budget, now);
  return entries.filter(
    (entry) =>
      entry.provider === budget.provider &&
      typeof entry.createdAt === "string" &&
      entry.createdAt >= since,
  );
}

/**
 * Used and remaining tokens for one budget's current window, counted by
 * when each run was logged. `belowReserve` tells the worker to hold back
 * lower-priority work.
 */
export function budgetStatus(
  budget: TokenBudget,
  entries: TableItem[],
  reservePercent: number,
  now: Date,
) {
  const usedTokens = entriesInWindow(budget, entries, now).reduce(
    (sum, entry) => sum + budgetTokensOf(entry),
    0,
  );
  const remainingTokens = Math.max(budget.limitTokens - usedTokens, 0);
  const remainingPercent =
    budget.limitTokens > 0 ? Math.round((remainingTokens / budget.limitTokens) * 100) : 0;

  return {
    ...budget,
    windowStart: windowStart(budget, now),
    usedTokens,
    remainingTokens,
    remainingPercent,
    belowReserve: remainingPercent < reservePercent,
  };
}
