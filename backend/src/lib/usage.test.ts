import { describe, expect, it } from "vitest";
import { TableItem } from "../db/client";
import { billUnderContract, summarize } from "./usage";

const contract = (fields: Record<string, unknown>): TableItem => ({
  pk: "USER#u",
  sk: "CONTRACT#c1",
  clientId: "pin",
  projectIds: ["maf"],
  billingMode: "invoiced",
  startDate: "2026-01-01",
  ...fields,
});
const snapshot = (fields: Record<string, unknown> = {}) => ({
  contractId: "c1",
  payUnit: "hourly",
  rate: 90,
  tokenBilling: "passthrough",
  tokenMarkup: 1,
  ...fields,
});
const human = (hours: number, fields: Record<string, unknown> = {}): TableItem => ({
  pk: "USER#u",
  sk: `TIME_ENTRY#h${hours}`,
  projectId: "maf",
  actorType: "human",
  hours,
  contractSnapshots: [snapshot()],
  ...fields,
});
const agent = (costUsd: number, fields: Record<string, unknown> = {}): TableItem => ({
  pk: "USER#u",
  sk: `TIME_ENTRY#a${costUsd}`,
  projectId: "maf",
  actorType: "agent",
  hours: 0.1,
  model: "claude-opus-5-5",
  costType: "paid",
  costUsd,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 10000,
  contractSnapshots: [snapshot()],
  ...fields,
});
const range = { from: "2026-03-01", to: "2026-03-31" };

describe("summarize", () => {
  it("splits human, billable and agent hours, and paid from local cost", () => {
    const totals = summarize([
      human(2),
      human(1, { billable: false }),
      agent(0.5),
      agent(0, { costType: "local", model: "qwen3-coder" }),
    ]);
    expect(totals).toMatchObject({
      humanHours: 3,
      billableHumanHours: 2,
      agentHours: 0.2,
      paidCostUsd: 0.5,
      localCostUsd: 0,
    });
    expect(totals.tokensByModel["claude-opus-5-5"]).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10000,
      cacheWriteTokens: 0,
    });
  });
});

describe("billUnderContract", () => {
  it("bills billable human hours at each entry's snapshot rate", () => {
    const bill = billUnderContract(contract({ payUnit: "hourly", rate: 100 }), [
      human(2),
      human(1, { contractSnapshots: [snapshot({ rate: 120 })] }),
      human(5, { billable: false }),
    ], range);
    expect(bill.hoursAmount).toBe(300);
    expect(bill.feeAmount).toBe(0);
  });

  it("never bills agent hours at the hourly rate, only their token cost", () => {
    const bill = billUnderContract(contract({ payUnit: "hourly", rate: 90 }), [agent(1.25)], range);
    expect(bill.hoursAmount).toBe(0);
    expect(bill.tokenAmount).toBe(1.25);
  });

  it("applies the token markup when tokens are passed through", () => {
    const bill = billUnderContract(
      contract({ payUnit: "hourly", rate: 90 }),
      [agent(2, { contractSnapshots: [snapshot({ tokenMarkup: 1.15 })] })],
      range,
    );
    expect(bill.tokenAmount).toBe(2.3);
  });

  it("reports but doesn't bill tokens when they're included", () => {
    const bill = billUnderContract(
      contract({ payUnit: "hourly", rate: 90 }),
      [agent(2, { contractSnapshots: [snapshot({ tokenBilling: "included" })] })],
      range,
    );
    expect(bill).toMatchObject({ tokenCostUsd: 2, tokenAmount: 0, totalAmount: 0 });
  });

  it("charges a flat monthly fee per month the range and contract share", () => {
    const flat = contract({ payUnit: "flat", rate: 2000, flatRatePeriod: "monthly", startDate: "2026-02-15" });
    expect(billUnderContract(flat, [], { from: "2026-01-01", to: "2026-04-30" }).feeAmount).toBe(6000);
    expect(billUnderContract(flat, [], { from: "2025-01-01", to: "2025-12-31" }).feeAmount).toBe(0);
  });

  it("charges a one-time fee only in the range where the contract starts", () => {
    const once = contract({ payUnit: "flat", rate: 500, flatRatePeriod: "one-time", startDate: "2026-03-10" });
    expect(billUnderContract(once, [], range).feeAmount).toBe(500);
    expect(billUnderContract(once, [], { from: "2026-04-01", to: "2026-04-30" }).feeAmount).toBe(0);
  });

  it("works out the effective hourly rate of a flat fee net of token cost", () => {
    const flat = contract({ payUnit: "flat", rate: 2000, flatRatePeriod: "monthly" });
    const flatSnapshot = [snapshot({ payUnit: "flat", tokenBilling: "included" })];
    const bill = billUnderContract(
      flat,
      [human(20, { contractSnapshots: flatSnapshot }), agent(100, { contractSnapshots: flatSnapshot })],
      range,
    );
    expect(bill).toMatchObject({ feeAmount: 2000, tokenCostUsd: 100, humanHours: 20, effectiveHourlyRate: 95 });
  });

  it("ignores entries that this contract didn't cover when logged", () => {
    const bill = billUnderContract(contract({ payUnit: "hourly", rate: 90 }), [human(3, { contractSnapshots: [] })], range);
    expect(bill.totalAmount).toBe(0);
  });
});
