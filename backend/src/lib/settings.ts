import { TableItem } from "../db/client";
import { DEFAULT_BUDGET_RESERVE_PERCENT, TokenBudget } from "./token-budget";

/**
 * The user's SETTINGS item. Only the token budget fields are built so far
 * (see AGENT-WORKERS.md); the others in DATA-MODEL.md join them as their
 * features are built.
 */
export interface SettingsFields {
  tokenBudgets: TokenBudget[];
  budgetReservePercent: number;
}

export function toSettings(item: TableItem | undefined): SettingsFields {
  return {
    tokenBudgets: (item?.tokenBudgets as TokenBudget[] | undefined) ?? [],
    budgetReservePercent:
      (item?.budgetReservePercent as number | undefined) ?? DEFAULT_BUDGET_RESERVE_PERCENT,
  };
}
