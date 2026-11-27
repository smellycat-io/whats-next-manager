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

export const SK_PREFIX = "PROJECT#";

interface ProjectFields {
  name?: string;
  lifeAreaIds?: string[];
}

interface WorkRoleFields {
  isWorkRole?: boolean;
  marketRateMin?: number;
  marketRateMax?: number;
  actualPayRate?: number;
  payUnit?: "hourly" | "flat" | "per-project";
}

export function skFor(id: string): string {
  return `${SK_PREFIX}${id}`;
}

export function toProject(item: TableItem) {
  return {
    id: (item.sk as string).slice(SK_PREFIX.length),
    name: item.name,
    lifeAreaIds: (item.lifeAreaIds as string[] | undefined) ?? [],
    // Pay-rate fields only meaningful when isWorkRole is true, per
    // CLIENTS-INVOICING.md — normalized to null/false here rather than
    // left absent, so API consumers don't have to check for presence.
    isWorkRole: item.isWorkRole ?? false,
    marketRateMin: item.marketRateMin ?? null,
    marketRateMax: item.marketRateMax ?? null,
    actualPayRate: item.actualPayRate ?? null,
    payUnit: item.payUnit ?? null,
  };
}

export const projectsRouter = Router();
projectsRouter.use(requireUserId);

projectsRouter.get("/", async (req, res) => {
  const items = await queryByPk(userPk(req.userId), SK_PREFIX);
  res.json(items.map(toProject));
});

projectsRouter.post("/", async (req, res) => {
  const { name, lifeAreaIds } = bodyOf<ProjectFields>(req.body);
  if (!name) throw badRequest("name is required");

  const item: TableItem = {
    pk: userPk(req.userId),
    sk: skFor(randomUUID()),
    type: "PROJECT",
    name,
    lifeAreaIds: lifeAreaIds ?? [],
  };
  await putItem(item);
  res.status(201).json(toProject(item));
});

projectsRouter.put("/:id", async (req, res) => {
  const updates = pickDefinedFields(bodyOf<ProjectFields>(req.body), [
    "name",
    "lifeAreaIds",
  ]);
  const updated = await updateItem(userPk(req.userId), skFor(req.params.id), updates);
  if (!updated) throw notFound("Project");
  res.json(toProject(updated));
});

// Sets or clears work-role status and pay-rate fields — see
// CLIENTS-INVOICING.md. Turning isWorkRole off clears the pay-rate
// fields entirely (REMOVE, not just zeroed) rather than leaving stale
// numbers behind on a Project that's no longer billable.
projectsRouter.put("/:id/work-role", async (req, res) => {
  const body = bodyOf<WorkRoleFields>(req.body);
  const updates: Record<string, unknown> =
    body.isWorkRole === false
      ? {
          isWorkRole: false,
          marketRateMin: null,
          marketRateMax: null,
          actualPayRate: null,
          payUnit: null,
        }
      : {
          isWorkRole: true,
          ...pickDefinedFields(body, [
            "marketRateMin",
            "marketRateMax",
            "actualPayRate",
            "payUnit",
          ]),
        };

  const updated = await updateItem(userPk(req.userId), skFor(req.params.id), updates);
  if (!updated) throw notFound("Project");
  res.json(toProject(updated));
});

projectsRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteItem(userPk(req.userId), skFor(req.params.id));
  if (!deleted) throw notFound("Project");
  res.status(204).send();
});
