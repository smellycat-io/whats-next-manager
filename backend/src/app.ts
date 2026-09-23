import express, { Express } from "express";
import { healthRouter } from "./routes/health";

/**
 * Builds the Express app. Kept separate from lambda.ts so the app itself
 * is testable without spinning up API Gateway/Lambda machinery.
 *
 * Route modules are one file per resource (see routes/), matching the
 * endpoint list in DATA-MODEL.md. Only health.ts is implemented so far —
 * this is the scaffold, not the full backend. Next: tasks, projects,
 * life-areas, priority-levels, budget-cards, goals, categories, journal,
 * calendar, agent, auth/google — each as its own router, following the
 * same shape as health.ts.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.use("/health", healthRouter);

  // app.use("/tasks", tasksRouter);
  // app.use("/projects", projectsRouter);
  // app.use("/life-areas", lifeAreasRouter);
  // app.use("/priority-levels", priorityLevelsRouter);
  // app.use("/budget-cards", budgetCardsRouter);
  // app.use("/goals", goalsRouter);
  // app.use("/categories", categoriesRouter);
  // app.use("/journal", journalRouter);
  // app.use("/calendar", calendarRouter);
  // app.use("/agent", agentRouter);
  // app.use("/auth/google", googleAuthRouter);

  return app;
}
