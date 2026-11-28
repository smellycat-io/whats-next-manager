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
import {
  AREA_KINDS,
  AreaKind,
  DEFAULT_AREA_KIND,
  assertCanBecomeWorkArea,
  isAreaKind,
  kindOf,
} from "../lib/areas";

interface AreaFields {
  name: string;
  kind: AreaKind;
  defaultPriorityLevelId: string;
}

const INVALID_KIND_MESSAGE = `kind must be one of: ${AREA_KINDS.join(", ")}`;

function toArea(item: TableItem) {
  return {
    id: sortKeys.area.idOf(item),
    name: item.name,
    kind: kindOf(item),
    defaultPriorityLevelId: item.defaultPriorityLevelId,
    // Only ever present on shared Areas (sparse GSI1 — see WORKSPACES.md);
    // normalized to null here so API consumers always see the field rather
    // than having to check for its absence.
    sharedWorkspaceId: item.sharedWorkspaceId ?? null,
  };
}

export const areasRouter = Router();
areasRouter.use(requireUserId);

areasRouter.get("/", async (req, res) => {
  // Personal Areas only — doesn't yet include ones shared *to* this user by
  // a workspace they belong to (that needs the workspace membership → GSI1
  // lookup WORKSPACES.md describes as a separate, bigger authorization
  // layer, not built here).
  const items = await queryByPk(userPk(req.userId), sortKeys.area.prefix);
  res.json(items.map(toArea));
});

areasRouter.post("/", async (req, res) => {
  const { name, kind = DEFAULT_AREA_KIND, defaultPriorityLevelId } = bodyOf<AreaFields>(req.body);
  if (!name || !defaultPriorityLevelId) {
    throw badRequest("name and defaultPriorityLevelId are required");
  }
  if (!isAreaKind(kind)) throw badRequest(INVALID_KIND_MESSAGE);

  const item: TableItem = {
    pk: userPk(req.userId),
    sk: sortKeys.area.for(randomUUID()),
    type: "AREA",
    name,
    kind,
    defaultPriorityLevelId,
  };
  await putItem(item);
  res.status(201).json(toArea(item));
});

areasRouter.put("/:id", async (req, res) => {
  const body = bodyOf<AreaFields>(req.body);
  if (body.kind !== undefined && !isAreaKind(body.kind)) throw badRequest(INVALID_KIND_MESSAGE);
  if (body.kind === "work") await assertCanBecomeWorkArea(req.userId, req.params.id);

  const updates = pickDefinedFields(body, ["name", "kind", "defaultPriorityLevelId"]);
  const updated = await updateItem(userPk(req.userId), sortKeys.area.for(req.params.id), updates);
  if (!updated) throw notFound("Area");
  res.json(toArea(updated));
});

// Sets or clears sharedWorkspaceId — see WORKSPACES.md. Body:
// { sharedWorkspaceId: "<id>" } to share, { sharedWorkspaceId: null } (or
// omitted) to unshare. Unsharing removes the attribute entirely rather
// than setting it to a null value, so GSI1's sparse index excludes it
// again (see updateItem in db/client.ts).
areasRouter.put("/:id/share", async (req, res) => {
  const { sharedWorkspaceId } = bodyOf<{ sharedWorkspaceId: string | null }>(req.body);
  const updated = await updateItem(userPk(req.userId), sortKeys.area.for(req.params.id), {
    sharedWorkspaceId: sharedWorkspaceId ?? null,
  });
  if (!updated) throw notFound("Area");
  res.json(toArea(updated));
});

areasRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteItem(userPk(req.userId), sortKeys.area.for(req.params.id));
  if (!deleted) throw notFound("Area");
  res.status(204).send();
});
