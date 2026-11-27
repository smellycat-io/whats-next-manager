import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { deleteItem, queryByPk, updateItem } from "../db/client";
import { TEST_USER_ID } from "../test-support/fake-auth";

vi.mock("../auth/current-user", () => import("../test-support/fake-auth"));
vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  queryByPk: vi.fn(),
  putItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}));

const app = createApp();
const userPk = `USER#${TEST_USER_ID}`;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PUT /priority-levels", () => {
  it("writes only name and order, and skips ids that don't exist", async () => {
    vi.mocked(updateItem).mockImplementation(async (pk, sk, updates) =>
      sk === "PRIORITY_LEVEL#missing" ? undefined : { pk, sk, ...updates },
    );

    const response = await request(app)
      .put("/priority-levels")
      .send([
        { id: "safety", name: "Safety", order: 1, type: "BUDGET_CARD" },
        { id: "missing", order: 9 },
      ]);

    expect(response.status).toBe(200);
    expect(updateItem).toHaveBeenCalledWith(userPk, "PRIORITY_LEVEL#safety", {
      name: "Safety",
      order: 1,
    });
    expect(response.body).toEqual([{ id: "safety", name: "Safety", order: 1 }]);
  });

  it("rejects a body that isn't an array", async () => {
    const response = await request(app).put("/priority-levels").send({ id: "safety" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      status: "error",
      message: "body must be an array of { id, name?, order? }",
    });
  });
});

describe("DELETE /priority-levels/:id", () => {
  it("returns 404 when the level doesn't exist", async () => {
    vi.mocked(deleteItem).mockResolvedValue(false);
    const response = await request(app).delete("/priority-levels/missing");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ status: "error", message: "Priority level not found" });
  });

  it("returns 204 when the level is deleted", async () => {
    vi.mocked(deleteItem).mockResolvedValue(true);
    const response = await request(app).delete("/priority-levels/safety");
    expect(response.status).toBe(204);
  });
});

describe("error handling", () => {
  it("returns 400 for a malformed JSON body", async () => {
    const response = await request(app)
      .post("/priority-levels")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(response.status).toBe(400);
    expect(response.body.status).toBe("error");
  });

  it("returns 500 with the error message when storage fails", async () => {
    vi.mocked(queryByPk).mockRejectedValue(new Error("DynamoDB unavailable"));
    const response = await request(app).get("/priority-levels");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ status: "error", message: "DynamoDB unavailable" });
  });
});
