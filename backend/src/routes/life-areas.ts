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
import { badRequest, notFound } from "../http/errors";
import { bodyOf, pickDefinedFields } from "../http/request-body";

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
  // Personal Life Areas only — doesn't yet include ones shared *to* this
  // user by a workspace they belong to (that needs the workspace
  // membership → GSI1 lookup WORKSPACES.md describes as a separate,
  // bigger authorization layer, not built here).
  const items = await queryByPk(userPk(req.userId), SK_PREFIX);
  res.json(items.map(toLifeArea));
});

lifeAreasRouter.post("/", async (req, res) => {
  const { name, defaultPriorityLevelId } = bodyOf<LifeAreaFields>(req.body);
  if (!name || !defaultPriorityLevelId) {
    throw badRequest("name and defaultPriorityLevelId are required");
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
});

lifeAreasRouter.put("/:id", async (req, res) => {
  const updates = pickDefinedFields(bodyOf<LifeAreaFields>(req.body), [
    "name",
    "defaultPriorityLevelId",
  ]);
  const updated = await updateItem(userPk(req.userId), skFor(req.params.id), updates);
  if (!updated) throw notFound("Life Area");
  res.json(toLifeArea(updated));
});

// Sets or clears sharedWorkspaceId — see WORKSPACES.md. Body:
// { sharedWorkspaceId: "<id>" } to share, { sharedWorkspaceId: null } (or
// omitted) to unshare. Unsharing removes the attribute entirely rather
// than setting it to a null value, so GSI1's sparse index excludes it
// again (see updateItem in db/client.ts).
lifeAreasRouter.put("/:id/share", async (req, res) => {
  const { sharedWorkspaceId } = bodyOf<{ sharedWorkspaceId: string | null }>(req.body);
  const updated = await updateItem(userPk(req.userId), skFor(req.params.id), {
    sharedWorkspaceId: sharedWorkspaceId ?? null,
  });
  if (!updated) throw notFound("Life Area");
  res.json(toLifeArea(updated));
});

lifeAreasRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteItem(userPk(req.userId), skFor(req.params.id));
  if (!deleted) throw notFound("Life Area");
  res.status(204).send();
});
