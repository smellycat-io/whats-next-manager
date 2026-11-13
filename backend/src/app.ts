import express, { Express } from "express";
import { healthRouter } from "./routes/health";
import { priorityLevelsRouter } from "./routes/priority-levels";
import { lifeAreasRouter } from "./routes/life-areas";
import { projectsRouter } from "./routes/projects";
import { tasksRouter } from "./routes/tasks";

/**
 * Builds the Express app. Kept separate from lambda.ts so the app itself
 * is testable without spinning up API Gateway/Lambda machinery.
 *
 * Route modules are one file per resource (see routes/), matching the
 * endpoint list in DATA-MODEL.md. priority-levels, life-areas, projects,
 * and tasks are the foundational resources everything else (Goals,
 * Clients) references. Next: budget-cards, goals, categories, journal,
 * calendar, agent, auth/google, clients/time-entries/invoices — each as
 * its own router, following the same shape.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.use("/health", healthRouter);
  app.use("/priority-levels", priorityLevelsRouter);
  app.use("/life-areas", lifeAreasRouter);
  app.use("/projects", projectsRouter);
  app.use("/tasks", tasksRouter);

  // app.use("/budget-cards", budgetCardsRouter);
  // app.use("/goals", goalsRouter);
  // app.use("/categories", categoriesRouter);
  // app.use("/journal", journalRouter);
  // app.use("/calendar", calendarRouter);
  // app.use("/agent", agentRouter);
  // app.use("/auth/google", googleAuthRouter);

  return app;
}
