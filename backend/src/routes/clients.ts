import { Router } from "express";
import { randomUUID } from "crypto";
import { requireUserId } from "../auth/current-user";
import { TableItem, deleteItem, putItem, queryByPk, updateItem, userPk } from "../db/client";
import { sortKeys } from "../db/keys";
import { badRequest, conflict, notFound } from "../http/errors";
import { bodyOf, pickDefinedFields } from "../http/request-body";

/** A party being billed — see CLIENTS-INVOICING.md. */
interface ClientFields {
  name: string;
  contactName: string;
  contactEmail: string;
  billingAddress: string;
  notes: string;
  archived: boolean;
}

const UPDATABLE_FIELDS = [
  "name",
  "contactName",
  "contactEmail",
  "billingAddress",
  "notes",
  "archived",
] as const satisfies readonly (keyof ClientFields)[];

function toClient(item: TableItem) {
  return {
    id: sortKeys.client.idOf(item),
    name: item.name,
    contactName: item.contactName ?? null,
    contactEmail: item.contactEmail ?? null,
    billingAddress: item.billingAddress ?? null,
    notes: item.notes ?? null,
    archived: item.archived ?? false,
  };
}

export const clientsRouter = Router();
clientsRouter.use(requireUserId);

clientsRouter.get("/", async (req, res) => {
  const items = await queryByPk(userPk(req.userId), sortKeys.client.prefix);
  res.json(items.map(toClient));
});

clientsRouter.post("/", async (req, res) => {
  const body = bodyOf<ClientFields>(req.body);
  if (!body.name) throw badRequest("name is required");

  const item: TableItem = {
    pk: userPk(req.userId),
    sk: sortKeys.client.for(randomUUID()),
    type: "CLIENT",
    ...pickDefinedFields(body, UPDATABLE_FIELDS),
  };
  await putItem(item);
  res.status(201).json(toClient(item));
});

clientsRouter.put("/:id", async (req, res) => {
  const updates = pickDefinedFields(bodyOf<ClientFields>(req.body), UPDATABLE_FIELDS);
  const updated = await updateItem(userPk(req.userId), sortKeys.client.for(req.params.id), updates);
  if (!updated) throw notFound("Client");
  res.json(toClient(updated));
});

// A client with contracts keeps its billing history; archive it instead.
clientsRouter.delete("/:id", async (req, res) => {
  const pk = userPk(req.userId);
  const contracts = await queryByPk(pk, sortKeys.contract.prefix);
  if (contracts.some((contract) => contract.clientId === req.params.id)) {
    throw conflict("Client has contracts; archive it instead");
  }
  const deleted = await deleteItem(pk, sortKeys.client.for(req.params.id));
  if (!deleted) throw notFound("Client");
  res.status(204).send();
});
