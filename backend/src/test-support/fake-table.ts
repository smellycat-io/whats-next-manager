import type { TableItem } from "../db/client";

/**
 * An in-memory stand-in for db/client.ts, for route tests that are easier
 * to read as "given these items, expect this result" than as scripted
 * mock calls. Mirrors the real helpers' contracts: updates and deletes
 * never create items, `null` removes an attribute, `onlyIf` must match.
 * Swap it in with:
 *   vi.mock("../db/client", () => import("../test-support/fake-table"));
 */
const items = new Map<string, TableItem>();
const keyOf = (pk: string, sk: string) => `${pk}|${sk}`;

export function userPk(userId: string): string {
  return `USER#${userId}`;
}

export function resetTable(seed: TableItem[] = []): void {
  items.clear();
  seed.forEach((item) => items.set(keyOf(item.pk, item.sk), structuredClone(item)));
}

export function allItems(): TableItem[] {
  return [...items.values()];
}

export async function getItem(pk: string, sk: string): Promise<TableItem | undefined> {
  const item = items.get(keyOf(pk, sk));
  return item && structuredClone(item);
}

export async function putItem(item: TableItem): Promise<void> {
  const stored = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
  items.set(keyOf(item.pk, item.sk), structuredClone(stored) as TableItem);
}

export async function queryByPk(pk: string, skPrefix = ""): Promise<TableItem[]> {
  return allItems()
    .filter((item) => item.pk === pk && item.sk.startsWith(skPrefix))
    .sort((a, b) => a.sk.localeCompare(b.sk))
    .map((item) => structuredClone(item));
}

export async function updateItem(
  pk: string,
  sk: string,
  updates: Record<string, unknown>,
  onlyIf: Record<string, unknown> = {},
): Promise<TableItem | undefined> {
  const existing = items.get(keyOf(pk, sk));
  if (!existing || Object.entries(onlyIf).some(([key, value]) => existing[key] !== value)) {
    return undefined;
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) delete existing[key];
    else if (value !== undefined) existing[key] = structuredClone(value);
  }
  return structuredClone(existing);
}

export async function deleteItem(pk: string, sk: string): Promise<boolean> {
  return items.delete(keyOf(pk, sk));
}
