import { Router } from "express";
import { requireUserId } from "../auth/current-user";
import { TableItem, getItem, putItem, userPk } from "../db/client";
import { SETTINGS_SK } from "../db/keys";
import { badRequest } from "../http/errors";
import { assertNonNegativeNumber, assertOneOf, bodyOf } from "../http/request-body";
import { SettingsFields, toSettings } from "../lib/settings";
import { BUDGET_WINDOWS, TokenBudget } from "../lib/token-budget";
import { PROVIDERS } from "../lib/time-entries";

function assertValidBudget(budget: Partial<TokenBudget>, index: number): void {
  const field = (name: string) => `tokenBudgets[${index}].${name}`;
  if (!budget.provider || !budget.window || budget.limitTokens === undefined) {
    throw badRequest(`${field("provider")}, window and limitTokens are required`);
  }
  assertOneOf(budget.provider, PROVIDERS, field("provider"));
  assertOneOf(budget.window, BUDGET_WINDOWS, field("window"));
  assertNonNegativeNumber(budget.limitTokens, field("limitTokens"));
  assertNonNegativeNumber(budget.windowHours, field("windowHours"));
  if (budget.window === "rolling-hours" && !budget.windowHours) {
    throw badRequest(`${field("windowHours")} is required for rolling-hours budgets`);
  }
}

export const settingsRouter = Router();
settingsRouter.use(requireUserId);

settingsRouter.get("/", async (req, res) => {
  res.json(toSettings(await getItem(userPk(req.userId), SETTINGS_SK)));
});

// Merges the fields sent into the stored settings, creating the item on
// first write.
settingsRouter.put("/", async (req, res) => {
  const { tokenBudgets, budgetReservePercent } = bodyOf<SettingsFields>(req.body);
  if (tokenBudgets !== undefined) {
    if (!Array.isArray(tokenBudgets)) throw badRequest("tokenBudgets must be an array");
    tokenBudgets.forEach(assertValidBudget);
  }
  assertNonNegativeNumber(budgetReservePercent, "budgetReservePercent");
  if (budgetReservePercent !== undefined && budgetReservePercent > 100) {
    throw badRequest("budgetReservePercent must be 100 or less");
  }

  const pk = userPk(req.userId);
  const existing = await getItem(pk, SETTINGS_SK);
  const item: TableItem = {
    ...existing,
    pk,
    sk: SETTINGS_SK,
    type: "SETTINGS",
    ...(tokenBudgets !== undefined && { tokenBudgets }),
    ...(budgetReservePercent !== undefined && { budgetReservePercent }),
  };
  await putItem(item);
  res.json(toSettings(item));
});
