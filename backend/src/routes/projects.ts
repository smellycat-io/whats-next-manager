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
import { assertAtMostOneWorkArea } from "../lib/areas";

interface ProjectFields {
  name?: string;
  areaIds?: string[];
}

interface WorkRoleFields {
  isWorkRole?: boolean;
  marketRateMin?: number;
  marketRateMax?: number;
  actualPayRate?: number;
  payUnit?: "hourly" | "flat" | "per-project";
}

function toProject(item: TableItem) {
  return {
    id: sortKeys.project.idOf(item),
    name: item.name,
    areaIds: (item.areaIds as string[] | undefined) ?? [],
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
  const items = await queryByPk(userPk(req.userId), sortKeys.project.prefix);
  res.json(items.map(toProject));
});

projectsRouter.post("/", async (req, res) => {
  const { name, areaIds } = bodyOf<ProjectFields>(req.body);
  if (!name) throw badRequest("name is required");
  await assertAtMostOneWorkArea(req.userId, areaIds ?? []);

  const item: TableItem = {
    pk: userPk(req.userId),
    sk: sortKeys.project.for(randomUUID()),
    type: "PROJECT",
    name,
    areaIds: areaIds ?? [],
  };
  await putItem(item);
  res.status(201).json(toProject(item));
});

projectsRouter.put("/:id", async (req, res) => {
  const updates = pickDefinedFields(bodyOf<ProjectFields>(req.body), [
    "name",
    "areaIds",
  ]);
  if (updates.areaIds) await assertAtMostOneWorkArea(req.userId, updates.areaIds as string[]);
  const updated = await updateItem(userPk(req.userId), sortKeys.project.for(req.params.id), updates);
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

  const updated = await updateItem(userPk(req.userId), sortKeys.project.for(req.params.id), updates);
  if (!updated) throw notFound("Project");
  res.json(toProject(updated));
});

projectsRouter.delete("/:id", async (req, res) => {
  const deleted = await deleteItem(userPk(req.userId), sortKeys.project.for(req.params.id));
  if (!deleted) throw notFound("Project");
  res.status(204).send();
});
