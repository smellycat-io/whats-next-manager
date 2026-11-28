import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { TEST_ACTOR_HEADER, TEST_USER_ID } from "../test-support/fake-auth";
import { allItems, resetTable } from "../test-support/fake-table";

vi.mock("../auth/current-user", () => import("../test-support/fake-auth"));
vi.mock("../db/client", () => import("../test-support/fake-table"));

/**
 * Clients, Contracts and time entries together, since billing rules span
 * them — see CLIENTS-INVOICING.md.
 */
const app = createApp();
const pk = `USER#${TEST_USER_ID}`;

const PIN_CLIENT = { pk, sk: "CLIENT#pin", name: "PIN" };
const MAF_CLIENT = { pk, sk: "CLIENT#maf", name: "MAF" };
const PIN_AREA = { pk, sk: "AREA#pin", kind: "work", name: "PIN" };
const PERSONAL_AREA = { pk, sk: "AREA#personal", kind: "life", name: "Personal" };
const MAF_PROJECT = { pk, sk: "PROJECT#maf", name: "MAF engagement", areaIds: ["pin"] };

const userToPin = {
  clientId: "pin",
  projectIds: ["maf"],
  billingMode: "invoiced",
  payUnit: "hourly",
  rate: 90,
  startDate: "2026-01-01",
};
const pinToMaf = {
  issuerAreaId: "pin",
  clientId: "maf",
  projectIds: ["maf"],
  billingMode: "tracking",
  payUnit: "flat",
  rate: 2000,
  flatRatePeriod: "monthly",
  tokenBilling: "included",
  startDate: "2026-01-01",
};

beforeEach(() => {
  resetTable([PIN_CLIENT, MAF_CLIENT, PIN_AREA, PERSONAL_AREA, MAF_PROJECT]);
});

describe("POST /contracts", () => {
  it("creates a contract with token billing defaults", async () => {
    const response = await request(app).post("/contracts").send(userToPin);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ issuerAreaId: null, tokenBilling: "passthrough", tokenMarkup: 1 });
  });

  it("requires a period for flat contracts", async () => {
    const response = await request(app).post("/contracts").send({ ...pinToMaf, flatRatePeriod: undefined });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("flatRatePeriod is required for flat contracts");
  });

  it("requires the issuer to be a Work Area", async () => {
    const response = await request(app).post("/contracts").send({ ...pinToMaf, issuerAreaId: "personal" });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("issuerAreaId must be a Work Area");
  });

  it("rejects an unknown client", async () => {
    const response = await request(app).post("/contracts").send({ ...userToPin, clientId: "nobody" });
    expect(response.status).toBe(400);
  });

  it("rejects a second overlapping contract in the same billing layer", async () => {
    await request(app).post("/contracts").send(userToPin);
    const response = await request(app).post("/contracts").send({ ...userToPin, rate: 100 });
    expect(response.status).toBe(409);
  });

  it("allows both billing layers on the same project", async () => {
    await request(app).post("/contracts").send(userToPin);
    const response = await request(app).post("/contracts").send(pinToMaf);
    expect(response.status).toBe(201);
  });
});

describe("PUT /contracts/:id", () => {
  it("validates the contract as it will be after the update", async () => {
    const { body: created } = await request(app).post("/contracts").send(userToPin);
    const response = await request(app).put(`/contracts/${created.id}`).send({ payUnit: "flat" });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("flatRatePeriod is required for flat contracts");
  });

  it("clears a field sent as null", async () => {
    const { body: created } = await request(app).post("/contracts").send({ ...userToPin, endDate: "2026-12-31" });
    const response = await request(app).put(`/contracts/${created.id}`).send({ endDate: null });
    expect(response.body.endDate).toBeNull();
  });
});

describe("POST /time-entries", () => {
  it("snapshots every contract covering the work, one per billing layer", async () => {
    await request(app).post("/contracts").send(userToPin);
    await request(app).post("/contracts").send(pinToMaf);
    const response = await request(app)
      .post("/time-entries")
      .send({ projectId: "maf", date: "2026-03-02", hours: 2 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ actorType: "human", billable: true, createdBy: TEST_USER_ID });
    expect(response.body.contractSnapshots).toHaveLength(2);
    expect(response.body.contractSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ issuerAreaId: null, clientId: "pin", payUnit: "hourly", rate: 90 }),
        expect.objectContaining({ issuerAreaId: "pin", clientId: "maf", tokenBilling: "included" }),
      ]),
    );
  });

  it("keeps the snapshot when contract terms change later", async () => {
    const { body: contract } = await request(app).post("/contracts").send(userToPin);
    const { body: entry } = await request(app)
      .post("/time-entries")
      .send({ projectId: "maf", date: "2026-03-02", hours: 2 });
    await request(app).put(`/contracts/${contract.id}`).send({ rate: 150 });

    const { body: entries } = await request(app).get("/time-entries");
    expect(entries.find((e: { id: string }) => e.id === entry.id).contractSnapshots[0].rate).toBe(90);
  });

  it("logs a delegate's entry as an agent run with its usage", async () => {
    const response = await request(app)
      .post("/time-entries")
      .set(TEST_ACTOR_HEADER, "agent")
      .send({
        projectId: "maf",
        date: "2026-03-02",
        hours: 0.25,
        provider: "anthropic",
        model: "claude-opus-5-5",
        costType: "paid",
        costBasis: "api-equivalent",
        inputTokens: 1200,
        outputTokens: 800,
        cacheReadTokens: 50000,
        costUsd: 0.42,
      });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      actorType: "agent",
      model: "claude-opus-5-5",
      cacheReadTokens: 50000,
      cacheWriteTokens: 0,
      costUsd: 0.42,
      createdBy: "agent",
    });
  });

  it("requires the agent-run fields on agent entries", async () => {
    const response = await request(app)
      .post("/time-entries")
      .set(TEST_ACTOR_HEADER, "agent")
      .send({ projectId: "maf", date: "2026-03-02", hours: 0.25 });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("provider, model and costType are required for agent entries");
  });

  it("requires a cost basis for paid runs", async () => {
    const response = await request(app)
      .post("/time-entries")
      .set(TEST_ACTOR_HEADER, "agent")
      .send({ projectId: "maf", date: "2026-03-02", hours: 0.25, provider: "anthropic", model: "m", costType: "paid" });
    expect(response.status).toBe(400);
  });

  it("doesn't store agent fields on a human entry", async () => {
    const response = await request(app)
      .post("/time-entries")
      .send({ projectId: "maf", date: "2026-03-02", hours: 1, model: "claude-opus-5-5" });
    expect(response.body.model).toBeUndefined();
    expect(allItems().find((item) => item.type === "TIME_ENTRY")?.model).toBeUndefined();
  });

  it("rejects an unknown project and a malformed date", async () => {
    expect((await request(app).post("/time-entries").send({ projectId: "nope", date: "2026-03-02", hours: 1 })).status).toBe(400);
    expect((await request(app).post("/time-entries").send({ projectId: "maf", date: "03/02/2026", hours: 1 })).status).toBe(400);
  });
});

describe("invoiced entries", () => {
  beforeEach(() => {
    resetTable([
      PIN_CLIENT,
      MAF_PROJECT,
      { pk, sk: "CONTRACT#c1", clientId: "pin", projectIds: ["maf"], startDate: "2026-01-01" },
      { pk, sk: "TIME_ENTRY#e1", projectId: "maf", date: "2026-03-02", hours: 2, invoicedContractIds: ["c1"] },
    ]);
  });

  it("can't be edited or deleted", async () => {
    expect((await request(app).put("/time-entries/e1").send({ hours: 3 })).status).toBe(409);
    expect((await request(app).delete("/time-entries/e1")).status).toBe(409);
  });

  it("make deleting their contract archive it instead", async () => {
    const response = await request(app).delete("/contracts/c1");
    expect(response.status).toBe(200);
    expect(response.body.archived).toBe(true);
  });
});

describe("DELETE /clients/:id", () => {
  it("refuses while contracts reference the client", async () => {
    await request(app).post("/contracts").send(userToPin);
    const response = await request(app).delete("/clients/pin");
    expect(response.status).toBe(409);
  });

  it("deletes a client with no contracts", async () => {
    expect((await request(app).delete("/clients/maf")).status).toBe(204);
  });
});
