import express, { Router } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getItem } from "../db/client";
import { errorHandler } from "../http/errors";
import { ACT_AS_USER_HEADER } from "./delegation";
import { requireUserId } from "./current-user";

vi.mock("../db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/client")>()),
  getItem: vi.fn(),
}));

const OWNER_ID = "owner";
const SERVICE_USER_ID = "agent";

/**
 * A minimal app that runs the real middleware. The claims header stands in
 * for the API Gateway event serverless-http would attach, since supertest
 * sends plain HTTP.
 */
function appWithRouterAt(path: string) {
  const app = express();
  app.use((req, _res, next) => {
    const sub = req.get("x-test-claims-sub");
    if (sub) {
      Object.assign(req, {
        apiGateway: { event: { requestContext: { authorizer: { claims: { sub } } } } },
      });
    }
    next();
  });
  const router = Router();
  router.use(requireUserId);
  router.all("/{*rest}", (req, res) => {
    res.json({ userId: req.userId, actorUserId: req.actorUserId });
  });
  app.use(path, router);
  app.use(errorHandler);
  return app;
}

function asCaller(sub: string, test: request.Test) {
  return test.set("x-test-claims-sub", sub);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("requireUserId", () => {
  it("rejects a request with no verified claims", async () => {
    const response = await request(appWithRouterAt("/tasks")).get("/tasks");
    expect(response.status).toBe(401);
  });

  it("uses the caller's own id when no act-as header is sent", async () => {
    const response = await asCaller(OWNER_ID, request(appWithRouterAt("/tasks")).get("/tasks"));
    expect(response.body).toEqual({ userId: OWNER_ID, actorUserId: OWNER_ID });
    expect(getItem).not.toHaveBeenCalled();
  });

  it("treats an act-as header naming the caller as a normal request", async () => {
    const response = await asCaller(
      OWNER_ID,
      request(appWithRouterAt("/tasks")).get("/tasks").set(ACT_AS_USER_HEADER, OWNER_ID),
    );
    expect(response.body).toEqual({ userId: OWNER_ID, actorUserId: OWNER_ID });
  });

  it("lets a delegate act as the owner on an allowed route", async () => {
    vi.mocked(getItem).mockResolvedValue({ pk: `USER#${OWNER_ID}`, sk: `DELEGATE#${SERVICE_USER_ID}` });
    const response = await asCaller(
      SERVICE_USER_ID,
      request(appWithRouterAt("/tasks")).put("/tasks/123").set(ACT_AS_USER_HEADER, OWNER_ID),
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: OWNER_ID, actorUserId: SERVICE_USER_ID });
    expect(getItem).toHaveBeenCalledWith(`USER#${OWNER_ID}`, `DELEGATE#${SERVICE_USER_ID}`);
  });

  it("refuses an act-as request without a delegation record", async () => {
    vi.mocked(getItem).mockResolvedValue(undefined);
    const response = await asCaller(
      SERVICE_USER_ID,
      request(appWithRouterAt("/tasks")).get("/tasks").set(ACT_AS_USER_HEADER, OWNER_ID),
    );
    expect(response.status).toBe(403);
  });

  it("refuses a delegate's delete, even with a delegation record", async () => {
    vi.mocked(getItem).mockResolvedValue({ pk: `USER#${OWNER_ID}`, sk: `DELEGATE#${SERVICE_USER_ID}` });
    const response = await asCaller(
      SERVICE_USER_ID,
      request(appWithRouterAt("/tasks")).delete("/tasks/123").set(ACT_AS_USER_HEADER, OWNER_ID),
    );
    expect(response.status).toBe(403);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("refuses a delegate's write to a read-only route", async () => {
    const response = await asCaller(
      SERVICE_USER_ID,
      request(appWithRouterAt("/projects")).post("/projects").set(ACT_AS_USER_HEADER, OWNER_ID),
    );
    expect(response.status).toBe(403);
  });

  it("refuses a delegate on a route that isn't allowlisted", async () => {
    const response = await asCaller(
      SERVICE_USER_ID,
      request(appWithRouterAt("/settings")).get("/settings").set(ACT_AS_USER_HEADER, OWNER_ID),
    );
    expect(response.status).toBe(403);
  });
});
