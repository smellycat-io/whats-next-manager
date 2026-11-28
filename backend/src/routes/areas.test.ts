import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { putItem, updateItem } from "../db/client";
import { assertCanBecomeWorkArea } from "../lib/areas";

vi.mock("../auth/current-user", () => import("../test-support/fake-auth"));
vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  putItem: vi.fn(),
  updateItem: vi.fn(),
}));
vi.mock("../lib/areas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/areas")>()),
  assertCanBecomeWorkArea: vi.fn(),
}));

const app = createApp();

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /areas", () => {
  it("defaults kind to life", async () => {
    const response = await request(app)
      .post("/areas")
      .send({ name: "Personal", defaultPriorityLevelId: "level" });
    expect(response.status).toBe(201);
    expect(response.body.kind).toBe("life");
    expect(vi.mocked(putItem).mock.calls[0][0]).toMatchObject({ type: "AREA", kind: "life" });
  });

  it("rejects an unknown kind", async () => {
    const response = await request(app)
      .post("/areas")
      .send({ name: "PIN", kind: "job", defaultPriorityLevelId: "level" });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("kind must be one of: life, work, project");
  });
});

describe("PUT /areas/:id", () => {
  it("checks the one-Work-Area rule before turning an Area into a Work Area", async () => {
    vi.mocked(updateItem).mockImplementation(async (pk, sk, updates) => ({ pk, sk, ...updates }));
    const response = await request(app).put("/areas/pin").send({ kind: "work" });
    expect(response.status).toBe(200);
    expect(assertCanBecomeWorkArea).toHaveBeenCalledWith("test-user", "pin");
    expect(response.body).toMatchObject({ id: "pin", kind: "work" });
  });

  it("doesn't run the check for other kinds", async () => {
    vi.mocked(updateItem).mockImplementation(async (pk, sk, updates) => ({ pk, sk, ...updates }));
    await request(app).put("/areas/pin").send({ kind: "project" });
    expect(assertCanBecomeWorkArea).not.toHaveBeenCalled();
  });
});
