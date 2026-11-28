import { describe, expect, it } from "vitest";
import { TableItem } from "../db/client";
import { TokenBudget, budgetStatus, budgetTokensOf } from "./token-budget";

const now = new Date("2026-11-28T12:00:00.000Z");
const run = (createdAt: string, fields: Record<string, unknown> = {}): TableItem => ({
  pk: "USER#u",
  sk: `TIME_ENTRY#${createdAt}`,
  actorType: "agent",
  provider: "anthropic",
  costType: "paid",
  inputTokens: 1000,
  outputTokens: 500,
  cacheWriteTokens: 200,
  cacheReadTokens: 90000,
  createdAt,
  ...fields,
});
const fiveHours: TokenBudget = { provider: "anthropic", window: "rolling-hours", windowHours: 5, limitTokens: 10000 };

describe("budgetTokensOf", () => {
  it("counts input, output and cache writes, but not cache reads", () => {
    expect(budgetTokensOf(run("2026-11-28T11:00:00.000Z"))).toBe(1700);
  });

  it("doesn't count local runs or human entries", () => {
    expect(budgetTokensOf(run("x", { costType: "local" }))).toBe(0);
    expect(budgetTokensOf(run("x", { actorType: "human" }))).toBe(0);
  });
});

describe("budgetStatus", () => {
  it("counts only runs inside the window for the budget's provider", () => {
    const status = budgetStatus(
      fiveHours,
      [
        run("2026-11-28T11:00:00.000Z"),
        run("2026-11-28T08:00:00.000Z"),
        run("2026-11-28T06:59:59.000Z"),
        run("2026-11-28T11:30:00.000Z", { provider: "ollama" }),
      ],
      20,
      now,
    );
    expect(status).toMatchObject({
      windowStart: "2026-11-28T07:00:00.000Z",
      usedTokens: 3400,
      remainingTokens: 6600,
      remainingPercent: 66,
      belowReserve: false,
    });
  });

  it("flags when remaining tokens drop under the reserve", () => {
    const entries = Array.from({ length: 5 }, () => run("2026-11-28T11:00:00.000Z"));
    const status = budgetStatus(fiveHours, entries, 20, now);
    expect(status).toMatchObject({ usedTokens: 8500, remainingPercent: 15, belowReserve: true });
  });

  it("uses a 7-day window for weekly budgets", () => {
    const weekly: TokenBudget = { provider: "anthropic", window: "weekly", limitTokens: 100000 };
    expect(budgetStatus(weekly, [], 20, now).windowStart).toBe("2026-11-21T12:00:00.000Z");
  });
});
