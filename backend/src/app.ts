import express, { Express } from "express";
import { healthRouter } from "./routes/health";
import { priorityLevelsRouter } from "./routes/priority-levels";
import { areasRouter } from "./routes/areas";
import { clientsRouter } from "./routes/clients";
import { contractsRouter } from "./routes/contracts";
import { projectsRouter } from "./routes/projects";
import { tasksRouter } from "./routes/tasks";
import { timeEntriesRouter } from "./routes/time-entries";
import { errorHandler } from "./http/errors";
import { parseLambdaJsonBody } from "./http/lambda-json-body";

/**
 * Builds the Express app. Kept separate from lambda.ts so the app itself
 * is testable without spinning up API Gateway/Lambda machinery.
 *
 * Route modules are one file per resource (see routes/), matching the
 * endpoint list in DATA-MODEL.md. Resources not built yet get their own
 * router in the same shape when they are.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(parseLambdaJsonBody);

  app.use("/health", healthRouter);
  app.use("/priority-levels", priorityLevelsRouter);
  app.use("/areas", areasRouter);
  app.use("/projects", projectsRouter);
  app.use("/tasks", tasksRouter);
  app.use("/clients", clientsRouter);
  app.use("/contracts", contractsRouter);
  app.use("/time-entries", timeEntriesRouter);

  // Registered last so it catches errors from every router above.
  app.use(errorHandler);

  return app;
}
