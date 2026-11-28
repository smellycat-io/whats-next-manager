import { Router } from "express";
import { randomUUID } from "crypto";
import { requireUserId } from "../auth/current-user";
import {
  TableItem,
  deleteItem,
  putItem,
  queryByPk,
  updateItem,
  userPk,
} from "../db/client";
import { sortKeys } from "../db/keys";
import { badRequest, notFound } from "../http/errors";
import { bodyOf, pickDefinedFields } from "../http/request-body";

interface PriorityLevelFields {
  name: string;
  order: number;
}

// Seeded on first GET for a new user — see ARCHITECTURE.md's Priority
// Ladder screen. Order here is the default ladder order (top = highest).
const DEFAULT_PRIORITY_LEVEL_NAMES = [
  "Physiological",
  "Safety",
  "Love/Belonging",
  "Esteem",
  "Self-Actualization",
];

function toPriorityLevel(item: TableItem) {
  return {
    id: sortKeys.priorityLevel.idOf(item),
    name: item.name,
    order: item.order,
  };
}

function sortByOrder(items: TableItem[]): TableItem[] {
  return [...items].sort(
    (a, b) => (a.order as number) - (b.order as number),
  );
}

async function seedDefaultsIfEmpty(userId: string): Promise<TableItem[]> {
  const existing = await queryByPk(userPk(userId), sortKeys.priorityLevel.prefix);
  if (existing.length > 0) {
    return sortByOrder(existing);
  }

  const seeded = await Promise.all(
    DEFAULT_PRIORITY_LEVEL_NAMES.map(async (name, order) => {
      const item: TableItem = {
        pk: userPk(userId),
        sk: sortKeys.priorityLevel.for(randomUUID()),
        type: "PRIORITY_LEVEL",
        name,
        order,
      };
      await putItem(item);
      return item;
    }),
  );
  return sortByOrder(seeded);
}

export const priorityLevelsRouter = Router();
priorityLevelsRouter.use(requireUserId);

priorityLevelsRouter.get("/", async (req, res) => {
  const levels = await seedDefaultsIfEmpty(req.userId);
  res.json(levels.map(toPriorityLevel));
});

priorityLevelsRouter.post("/", async (req, res) => {
  const { name, order } = bodyOf<PriorityLevelFields>(req.body);
  if (!name) throw badRequest("name is required");

  let resolvedOrder = order;
  if (resolvedOrder === undefined) {
    const existing = await queryByPk(userPk(req.userId), sortKeys.priorityLevel.prefix);
    resolvedOrder =
      existing.length === 0
        ? 0
        : Math.max(...existing.map((level) => level.order as number)) + 1;
  }

  const item: TableItem = {
    pk: userPk(req.userId),
    sk: sortKeys.priorityLevel.for(randomUUID()),
    type: "PRIORITY_LEVEL",
    name,
    order: resolvedOrder,
  };
  await putItem(item);
  res.status(201).json(toPriorityLevel(item));
});

// Bulk update — DATA-MODEL.md documents this as the reorder endpoint, and
// it's the only PUT this resource has, so renames (ARCHITECTURE.md's
// "fully editable") go through here too: body is an array of
// { id, name?, order? }, each item updated with whichever fields it
// includes. Ids that don't exist are skipped (updateItem never creates
// items), so the response lists only the levels actually updated.
priorityLevelsRouter.put("/", async (req, res) => {
  const updatesList: unknown = req.body;
  if (!Array.isArray(updatesList)) {
    throw badRequest("body must be an array of { id, name?, order? }");
  }

  const updated = await Promise.all(
    updatesList.map(({ id, ...fields }: { id: string } & Partial<PriorityLevelFields>) =>
      updateItem(
        userPk(req.userId),
        sortKeys.priorityLevel.for(id),
        pickDefinedFields<PriorityLevelFields>(fields, ["name", "order"]),
      ),
    ),
  );
  res.json(
    updated
      .filter((item): item is TableItem => item !== undefined)
      .map(toPriorityLevel),
  );
});

priorityLevelsRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteItem(userPk(req.userId), sortKeys.priorityLevel.for(req.params.id));
  if (!deleted) throw notFound("Priority level");
  res.status(204).send();
});
