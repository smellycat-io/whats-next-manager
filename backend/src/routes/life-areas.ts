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

const SK_PREFIX = "LIFE_AREA#";

interface LifeAreaFields {
  name?: string;
  defaultPriorityLevelId?: string;
}

function skFor(id: string): string {
  return `${SK_PREFIX}${id}`;
}

function toLifeArea(item: TableItem) {
  return {
    id: (item.sk as string).slice(SK_PREFIX.length),
    name: item.name,
    defaultPriorityLevelId: item.defaultPriorityLevelId,
    // Only ever present on shared Life Areas (sparse GSI1 — see
    // WORKSPACES.md); normalized to null here so API consumers always
    // see the field rather than having to check for its absence.
    sharedWorkspaceId: item.sharedWorkspaceId ?? null,
  };
}

export const lifeAreasRouter = Router();
lifeAreasRouter.use(requireUserId);

lifeAreasRouter.get("/", async (req, res) => {
  try {
    // Personal Life Areas only — doesn't yet include ones shared *to* this
    // user by a workspace they belong to (that needs the workspace
    // membership → GSI1 lookup WORKSPACES.md describes as a separate,
    // bigger authorization layer, not built here).
    const items = await queryByPk(userPk(req.userId), SK_PREFIX);
    res.json(items.map(toLifeArea));
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

lifeAreasRouter.post("/", async (req, res) => {
  try {
    const { name, defaultPriorityLevelId } = (req.body ?? {}) as LifeAreaFields;
    if (!name || !defaultPriorityLevelId) {
      res.status(400).json({
        status: "error",
        message: "name and defaultPriorityLevelId are required",
      });
      return;
    }

    const item: TableItem = {
      pk: userPk(req.userId),
      sk: skFor(randomUUID()),
      type: "LIFE_AREA",
      name,
      defaultPriorityLevelId,
    };
    await putItem(item);
    res.status(201).json(toLifeArea(item));
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

lifeAreasRouter.put("/:id", async (req, res) => {
  try {
    const pk = userPk(req.userId);
    const sk = skFor(req.params.id);
    const existing = await getItem(pk, sk);
    if (!existing) {
      res.status(404).json({ status: "error", message: "Life Area not found" });
      return;
    }

    const { name, defaultPriorityLevelId } = (req.body ?? {}) as LifeAreaFields;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (defaultPriorityLevelId !== undefined) {
      updates.defaultPriorityLevelId = defaultPriorityLevelId;
    }

    const updated = await updateItem(pk, sk, updates);
    res.json(toLifeArea(updated as TableItem));
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Sets or clears sharedWorkspaceId — see WORKSPACES.md. Body:
// { sharedWorkspaceId: "<id>" } to share, { sharedWorkspaceId: null } (or
// omitted) to unshare. Unsharing removes the attribute entirely rather
// than setting it to a null value, so GSI1's sparse index excludes it
// again (see updateItem in db/client.ts).
lifeAreasRouter.put("/:id/share", async (req, res) => {
  try {
    const pk = userPk(req.userId);
    const sk = skFor(req.params.id);
    const existing = await getItem(pk, sk);
    if (!existing) {
      res.status(404).json({ status: "error", message: "Life Area not found" });
      return;
    }

    const { sharedWorkspaceId } = (req.body ?? {}) as {
      sharedWorkspaceId?: string | null;
    };
    const updated = await updateItem(pk, sk, {
      sharedWorkspaceId: sharedWorkspaceId ?? null,
    });
    res.json(toLifeArea(updated as TableItem));
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

lifeAreasRouter.delete("/:id", async (req, res) => {
  try {
    const pk = userPk(req.userId);
    const sk = skFor(req.params.id);
    const existing = await getItem(pk, sk);
    if (!existing) {
      res.status(404).json({ status: "error", message: "Life Area not found" });
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
