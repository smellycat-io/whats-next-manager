import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { TableItem, deleteItem, getItem, putItem, queryByPk, updateItem } from "../db/client";
import { TEST_ACTOR_HEADER, TEST_USER_ID } from "../test-support/fake-auth";

vi.mock("../auth/current-user", () => import("../test-support/fake-auth"));
vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  getItem: vi.fn(),
  putItem: vi.fn(),
  queryByPk: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}));

const app = createApp();
const userPk = `USER#${TEST_USER_ID}`;
const task = (id: string, fields: Record<string, unknown> = {}): TableItem => ({
  pk: userPk,
  sk: `TASK#${id}`,
  name: id,
  ...fields,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(updateItem).mockImplementation(async (pk, sk, updates) => ({ pk, sk, ...updates }));
});

describe("POST /tasks", () => {
  it("puts a task with no Area or project in Unsorted, stamped with its creator", async () => {
    const response = await request(app).post("/tasks").send({ name: "Call the vet", source: "phone" });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ status: "Unsorted", source: "phone", createdBy: TEST_USER_ID });
    expect(response.body.createdAt).toBe(response.body.updatedAt);
  });

  it("defaults a task with a project to Backlog", async () => {
    vi.mocked(getItem).mockResolvedValue(undefined);
    const response = await request(app).post("/tasks").send({ name: "Draft brief", projectId: "p1" });
    expect(response.body.status).toBe("Backlog");
  });

  it("marks tasks created by an agent as agent-sourced, whatever source it claims", async () => {
    const response = await request(app)
      .post("/tasks")
      .set(TEST_ACTOR_HEADER, "agent")
      .send({ name: "Follow up", source: "phone" });
    expect(response.body).toMatchObject({ source: "agent", createdBy: "agent" });
  });

  it("rejects an unknown status", async () => {
    const response = await request(app).post("/tasks").send({ name: "x", status: "Inbox" });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("status must be one of: Unsorted, Backlog, To Do, In Progress, Done");
  });

  it("refuses to create a task already claimed", async () => {
    const response = await request(app).post("/tasks").send({ name: "x", agentState: "claimed" });
    expect(response.status).toBe(400);
    expect(putItem).not.toHaveBeenCalled();
  });
});

describe("GET /tasks", () => {
  it("filters by agentState and updatedSince", async () => {
    vi.mocked(queryByPk).mockResolvedValue([
      task("old", { agentState: "queued", updatedAt: "2026-11-01T00:00:00.000Z" }),
      task("new", { agentState: "queued", updatedAt: "2026-11-20T00:00:00.000Z" }),
      task("running", { agentState: "running", updatedAt: "2026-11-21T00:00:00.000Z" }),
    ]);
    const response = await request(app).get("/tasks?agentState=queued&updatedSince=2026-11-10T00:00:00.000Z");
    expect(response.body.map((t: { id: string }) => t.id)).toEqual(["new"]);
  });
});

describe("PUT /tasks/:id", () => {
  it("releases the claim when a task is requeued", async () => {
    await request(app).put("/tasks/t1").send({ agentState: "queued" });
    expect(vi.mocked(updateItem).mock.calls[0][2]).toMatchObject({
      agentState: "queued",
      agentClaimedBy: null,
      agentClaimedAt: null,
      agentHeartbeatAt: null,
    });
  });

  it("stamps updatedAt on every update", async () => {
    await request(app).put("/tasks/t1").send({ name: "Renamed" });
    expect(vi.mocked(updateItem).mock.calls[0][2].updatedAt).toEqual(expect.any(String));
  });
});

describe("POST /tasks/:id/claim", () => {
  it("claims a queued task for the worker", async () => {
    const response = await request(app).post("/tasks/t1/claim").send({ workerId: "mac" });
    expect(response.status).toBe(200);
    expect(vi.mocked(updateItem).mock.calls[0][3]).toEqual({ agentState: "queued" });
    expect(response.body).toMatchObject({ agentState: "claimed", agentClaimedBy: "mac" });
  });

  it("returns 409 when the task is no longer queued", async () => {
    vi.mocked(updateItem).mockResolvedValue(undefined);
    vi.mocked(getItem).mockResolvedValue(task("t1", { agentState: "claimed" }));
    const response = await request(app).post("/tasks/t1/claim").send({ workerId: "mac" });
    expect(response.status).toBe(409);
    expect(response.body.message).toBe("Task is not queued");
  });

  it("returns 404 when the task doesn't exist", async () => {
    vi.mocked(updateItem).mockResolvedValue(undefined);
    vi.mocked(getItem).mockResolvedValue(undefined);
    const response = await request(app).post("/tasks/missing/claim").send({ workerId: "mac" });
    expect(response.status).toBe(404);
  });

  it("requires a workerId", async () => {
    const response = await request(app).post("/tasks/t1/claim").send({});
    expect(response.status).toBe(400);
  });
});

describe("POST /tasks/:id/heartbeat", () => {
  it("only extends a claim held by the same worker", async () => {
    vi.mocked(updateItem).mockResolvedValue(undefined);
    vi.mocked(getItem).mockResolvedValue(task("t1", { agentClaimedBy: "pi" }));
    const response = await request(app).post("/tasks/t1/heartbeat").send({ workerId: "mac" });
    expect(vi.mocked(updateItem).mock.calls[0][3]).toEqual({ agentClaimedBy: "mac" });
    expect(response.status).toBe(409);
  });
});

describe("task updates", () => {
  it("records the actor and bumps the task's updatedAt", async () => {
    vi.mocked(getItem).mockResolvedValue(task("t1"));
    const response = await request(app)
      .post("/tasks/t1/updates")
      .set(TEST_ACTOR_HEADER, "agent")
      .send({ kind: "progress", text: "Drafted the outline" });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ taskId: "t1", kind: "progress", actorUserId: "agent" });
    expect(vi.mocked(putItem).mock.calls[0][0].sk).toMatch(/^TASK_UPDATE#t1#\d{4}-/);
    expect(updateItem).toHaveBeenCalledWith(userPk, "TASK#t1", { updatedAt: expect.any(String) });
  });

  it("returns 404 for a task that doesn't exist", async () => {
    vi.mocked(getItem).mockResolvedValue(undefined);
    const response = await request(app).post("/tasks/missing/updates").send({ kind: "progress", text: "x" });
    expect(response.status).toBe(404);
    expect(putItem).not.toHaveBeenCalled();
  });

  it("lists one task's updates by their shared prefix", async () => {
    vi.mocked(queryByPk).mockResolvedValue([]);
    await request(app).get("/tasks/t1/updates");
    expect(queryByPk).toHaveBeenCalledWith(userPk, "TASK_UPDATE#t1#");
  });
});

describe("DELETE /tasks/:id", () => {
  it("deletes the task's progress log with it", async () => {
    vi.mocked(deleteItem).mockResolvedValue(true);
    vi.mocked(queryByPk).mockResolvedValue([
      { pk: userPk, sk: "TASK_UPDATE#t1#2026-11-01T00:00:00.000Z#a" },
      { pk: userPk, sk: "TASK_UPDATE#t1#2026-11-02T00:00:00.000Z#b" },
    ]);
    const response = await request(app).delete("/tasks/t1");
    expect(response.status).toBe(204);
    expect(queryByPk).toHaveBeenCalledWith(userPk, "TASK_UPDATE#t1#");
    expect(vi.mocked(deleteItem).mock.calls.map((call) => call[1])).toEqual([
      "TASK#t1",
      "TASK_UPDATE#t1#2026-11-01T00:00:00.000Z#a",
      "TASK_UPDATE#t1#2026-11-02T00:00:00.000Z#b",
    ]);
  });

  it("returns 404 without touching updates when the task doesn't exist", async () => {
    vi.mocked(deleteItem).mockResolvedValue(false);
    const response = await request(app).delete("/tasks/missing");
    expect(response.status).toBe(404);
    expect(queryByPk).not.toHaveBeenCalled();
  });
});
