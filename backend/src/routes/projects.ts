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
  try {
    const items = await queryByPk(userPk(req.userId), SK_PREFIX);
    res.json(items.map(toProject));
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

projectsRouter.post("/", async (req, res) => {
  try {
    const { name, lifeAreaIds } = (req.body ?? {}) as ProjectFields;
    if (!name) {
      res.status(400).json({ status: "error", message: "name is required" });
      return;
    }

    const item: TableItem = {
      pk: userPk(req.userId),
      sk: skFor(randomUUID()),
      type: "PROJECT",
      name,
      lifeAreaIds: lifeAreaIds ?? [],
    };
    await putItem(item);
    res.status(201).json(toProject(item));
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

projectsRouter.put("/:id", async (req, res) => {
  try {
    const pk = userPk(req.userId);
    const sk = skFor(req.params.id);
    const existing = await getItem(pk, sk);
    if (!existing) {
      res.status(404).json({ status: "error", message: "Project not found" });
      return;
    }

    const { name, lifeAreaIds } = (req.body ?? {}) as ProjectFields;
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (lifeAreaIds !== undefined) updates.lifeAreaIds = lifeAreaIds;

    const updated = await updateItem(pk, sk, updates);
    res.json(toProject(updated as TableItem));
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Sets or clears work-role status and pay-rate fields — see
// CLIENTS-INVOICING.md. Turning isWorkRole off clears the pay-rate
// fields entirely (REMOVE, not just zeroed) rather than leaving stale
// numbers behind on a Project that's no longer billable.
projectsRouter.put("/:id/work-role", async (req, res) => {
  try {
    const pk = userPk(req.userId);
    const sk = skFor(req.params.id);
    const existing = await getItem(pk, sk);
    if (!existing) {
      res.status(404).json({ status: "error", message: "Project not found" });
      return;
    }

    const { isWorkRole, marketRateMin, marketRateMax, actualPayRate, payUnit } =
      (req.body ?? {}) as WorkRoleFields;

    const updates: Record<string, unknown> =
      isWorkRole === false
        ? {
            isWorkRole: false,
            marketRateMin: null,
            marketRateMax: null,
            actualPayRate: null,
            payUnit: null,
          }
        : { isWorkRole: true };

    if (isWorkRole !== false) {
      if (marketRateMin !== undefined) updates.marketRateMin = marketRateMin;
      if (marketRateMax !== undefined) updates.marketRateMax = marketRateMax;
      if (actualPayRate !== undefined) updates.actualPayRate = actualPayRate;
      if (payUnit !== undefined) updates.payUnit = payUnit;
    }

    const updated = await updateItem(pk, sk, updates);
    res.json(toProject(updated as TableItem));
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

projectsRouter.delete("/:id", async (req, res) => {
  try {
    const pk = userPk(req.userId);
    const sk = skFor(req.params.id);
    const existing = await getItem(pk, sk);
    if (!existing) {
      res.status(404).json({ status: "error", message: "Project not found" });
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
