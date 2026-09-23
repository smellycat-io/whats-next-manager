import { Router } from "express";
import { getItem, putItem } from "../db/client";

/**
 * Simple liveness check — confirms the Lambda/API Gateway wiring works
 * before any real routes exist. Each resource (tasks, budget-cards, etc.)
 * should get its own router file following this same shape: one file,
 * one resource, business logic imported from a separate module rather
 * than written inline here.
 */
export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Temporary connectivity check for the shared DynamoDB data-access layer
 * (see db/client.ts) — writes then reads back one throwaway item to
 * confirm the table connection works end to end. Remove once real
 * resource routers exercise the same helpers.
 */
healthRouter.get("/db", async (_req, res) => {
  const pk = "HEALTHCHECK#db";
  const sk = "PING";
  try {
    const writtenAt = new Date().toISOString();
    await putItem({ pk, sk, type: "HEALTHCHECK", writtenAt });
    const item = await getItem(pk, sk);
    res.json({ status: "ok", item });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
