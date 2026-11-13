import { Router } from "express";
import { randomUUID } from "crypto";
import { requireUserId } from "../auth/current-user";
import {
  TableItem,
  deleteItem,
  getItem,
  putItem,
  queryByPk,
  updateItem,
  userPk,
} from "../db/client";

const SK_PREFIX = "PRIORITY_LEVEL#";

// Seeded on first GET for a new user — see ARCHITECTURE.md's Priority
// Ladder screen. Order here is the default ladder order (top = highest).
const DEFAULT_PRIORITY_LEVEL_NAMES = [
  "Physiological",
  "Safety",
  "Love/Belonging",
  "Esteem",
  "Self-Actualization",
];

function skFor(id: string): string {
  return `${SK_PREFIX}${id}`;
}

function toPriorityLevel(item: TableItem) {
  return {
    id: (item.sk as string).slice(SK_PREFIX.length),
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
  const existing = await queryByPk(userPk(userId), SK_PREFIX);
  if (existing.length > 0) {
    return sortByOrder(existing);
  }

  const seeded = await Promise.all(
    DEFAULT_PRIORITY_LEVEL_NAMES.map(async (name, order) => {
      const item: TableItem = {
        pk: userPk(userId),
        sk: skFor(randomUUID()),
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
  try {
    const levels = await seedDefaultsIfEmpty(req.userId);
    res.json(levels.map(toPriorityLevel));
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

priorityLevelsRouter.post("/", async (req, res) => {
  try {
    const { name, order } = (req.body ?? {}) as {
      name?: string;
      order?: number;
    };
    if (!name) {
      res.status(400).json({ status: "error", message: "name is required" });
      return;
    }

    let resolvedOrder = order;
    if (resolvedOrder === undefined) {
      const existing = await queryByPk(userPk(req.userId), SK_PREFIX);
      resolvedOrder =
        existing.length === 0
          ? 0
          : Math.max(...existing.map((level) => level.order as number)) + 1;
    }

    const item: TableItem = {
      pk: userPk(req.userId),
      sk: skFor(randomUUID()),
      type: "PRIORITY_LEVEL",
      name,
      order: resolvedOrder,
    };
    await putItem(item);
    res.status(201).json(toPriorityLevel(item));
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Bulk update — DATA-MODEL.md documents this as the reorder endpoint, and
// it's the only PUT this resource has, so renames (ARCHITECTURE.md's
// "fully editable") go through here too: body is an array of
// { id, name?, order? }, each item updated with whichever fields it
// includes. Callers always resend real ids from a prior GET, so this
// skips the existence check the single-item routes below do.
priorityLevelsRouter.put("/", async (req, res) => {
  try {
    const updatesList = req.body;
    if (!Array.isArray(updatesList)) {
      res.status(400).json({
        status: "error",
        message: "body must be an array of { id, name?, order? }",
      });
      return;
    }

    const updated = await Promise.all(
      updatesList.map(({ id, ...fields }) =>
        updateItem(userPk(req.userId), skFor(id), fields),
      ),
    );
    res.json(updated.filter(Boolean).map((item) => toPriorityLevel(item as TableItem)));
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

priorityLevelsRouter.delete("/:id", async (req, res) => {
  try {
    const pk = userPk(req.userId);
    const sk = skFor(req.params.id);
    const existing = await getItem(pk, sk);
    if (!existing) {
      res
        .status(404)
        .json({ status: "error", message: "Priority level not found" });
      return;
    }
    await deleteItem(pk, sk);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
