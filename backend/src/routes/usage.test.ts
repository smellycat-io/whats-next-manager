import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { TEST_USER_ID } from "../test-support/fake-auth";
import { resetTable } from "../test-support/fake-table";

vi.mock("../auth/current-user", () => import("../test-support/fake-auth"));
vi.mock("../db/client", () => import("../test-support/fake-table"));

const app = createApp();
const pk = `USER#${TEST_USER_ID}`;

const snapshot = (contractId: string, fields: Record<string, unknown> = {}) => ({
  contractId,
  payUnit: "hourly",
  rate: 100,
  tokenBilling: "passthrough",
  tokenMarkup: 1,
  ...fields,
});
const entry = (id: string, projectId: string, fields: Record<string, unknown>) => ({
  pk,
  sk: `TIME_ENTRY#${id}`,
  projectId,
  date: "2026-03-10",
  actorType: "human",
  hours: 1,
  ...fields,
});

beforeEach(() => {
  resetTable([
    { pk, sk: "AREA#pin", name: "PIN", kind: "work" },
    { pk, sk: "AREA#whats-next", name: "What's Next", kind: "project" },
    { pk, sk: "AREA#personal", name: "Personal", kind: "life" },
    { pk, sk: "PROJECT#maf", name: "MAF engagement", areaIds: ["pin"] },
    { pk, sk: "PROJECT#internal", name: "PIN internal", areaIds: ["pin", "personal"] },
    { pk, sk: "PROJECT#app", name: "App build", areaIds: ["whats-next"] },
    { pk, sk: "CONTRACT#user-pin", clientId: "pin", projectIds: ["maf", "internal"], billingMode: "invoiced", payUnit: "hourly", rate: 100, startDate: "2026-01-01" },
    { pk, sk: "CONTRACT#pin-maf", issuerAreaId: "pin", clientId: "maf", projectIds: ["maf"], billingMode: "tracking", payUnit: "flat", rate: 2000, flatRatePeriod: "monthly", tokenBilling: "included", startDate: "2026-01-01" },
    entry("maf-hours", "maf", { hours: 4, contractSnapshots: [snapshot("user-pin"), snapshot("pin-maf", { payUnit: "flat", tokenBilling: "included" })] }),
    entry("maf-agent", "maf", { actorType: "agent", hours: 0.5, model: "claude-opus-5-5", costType: "paid", costUsd: 3, contractSnapshots: [snapshot("user-pin"), snapshot("pin-maf", { payUnit: "flat", tokenBilling: "included" })] }),
    entry("internal-hours", "internal", { hours: 2, contractSnapshots: [snapshot("user-pin")] }),
    entry("app-agent", "app", { actorType: "agent", hours: 1, model: "claude-opus-5-5", costType: "paid", costUsd: 5 }),
    entry("out-of-range", "app", { date: "2026-05-01", hours: 9 }),
  ]);
});

const summary = (query: string) => request(app).get(`/usage/summary?from=2026-03-01&to=2026-03-31${query}`);

describe("GET /usage/summary", () => {
  it("requires a date range", async () => {
    expect((await request(app).get("/usage/summary")).status).toBe(400);
  });

  it("rejects more than one scope", async () => {
    expect((await summary("&areaId=pin&clientId=maf")).status).toBe(400);
  });

  it("splits unscoped usage by billing kind, counting each project once", async () => {
    const { body } = await summary("");
    expect(body.totals.humanHours).toBe(6);
    expect(body.byKind.work).toMatchObject({ humanHours: 6, paidCostUsd: 3 });
    expect(body.byKind.project).toMatchObject({ humanHours: 0, paidCostUsd: 5 });
    expect(body.byKind.life.humanHours).toBe(0);
    expect(body.areas.find((a: { areaId: string }) => a.areaId === "personal").totals.humanHours).toBe(2);
  });

  it("scopes to an Area's projects, billing every contract on them", async () => {
    const { body } = await summary("&areaId=pin");
    expect(body.totals).toMatchObject({ humanHours: 6, paidCostUsd: 3 });
    expect(body.projects.map((p: { projectId: string }) => p.projectId).sort()).toEqual(["internal", "maf"]);
    const userToPin = body.contracts.find((c: { contractId: string }) => c.contractId === "user-pin");
    expect(userToPin).toMatchObject({ hoursAmount: 600, tokenAmount: 3, totalAmount: 603 });
  });

  it("scopes to a client's contracts, with the flat-rate check", async () => {
    const { body } = await summary("&clientId=maf");
    expect(body.totals.humanHours).toBe(4);
    expect(body.contracts).toEqual([
      expect.objectContaining({ contractId: "pin-maf", feeAmount: 2000, tokenCostUsd: 3, tokenAmount: 0, effectiveHourlyRate: 499.25 }),
    ]);
  });
});

describe("token budget", () => {
  it("reports no budgets until they're set", async () => {
    expect((await request(app).get("/usage/budget")).body).toEqual({ reservePercent: 20, budgets: [] });
  });

  it("validates budgets and reports usage per window and Area", async () => {
    const invalid = await request(app)
      .put("/settings")
      .send({ tokenBudgets: [{ provider: "anthropic", window: "rolling-hours", limitTokens: 1000 }] });
    expect(invalid.status).toBe(400);

    await request(app)
      .put("/settings")
      .send({ tokenBudgets: [{ provider: "anthropic", window: "weekly", limitTokens: 10000 }], budgetReservePercent: 30 });
    const now = new Date().toISOString();
    await request(app)
      .post("/time-entries")
      .set("x-test-actor", "agent")
      .send({ projectId: "maf", date: now.slice(0, 10), hours: 0.1, provider: "anthropic", model: "m", costType: "paid", costBasis: "api-equivalent", inputTokens: 600, outputTokens: 400 });

    const { body } = await request(app).get("/usage/budget");
    expect(body.reservePercent).toBe(30);
    expect(body.budgets[0]).toMatchObject({ usedTokens: 1000, remainingTokens: 9000, belowReserve: false });
    expect(body.budgets[0].areas).toEqual([{ areaId: "pin", name: "PIN", kind: "work", usedTokens: 1000 }]);
  });
});
