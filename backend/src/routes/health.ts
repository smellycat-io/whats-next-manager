import { Router } from "express";

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
