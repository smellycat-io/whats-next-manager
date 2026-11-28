import { Router } from "express";
import { requireUserId } from "../auth/current-user";
import { TableItem, getItem, queryByPk, userPk } from "../db/client";
import { SETTINGS_SK, SortKey, sortKeys } from "../db/keys";
import { badRequest } from "../http/errors";
import { assertIsoDate } from "../http/request-body";
import { billingKindOf, kindOf } from "../lib/areas";
import { ContractSnapshot } from "../lib/contracts";
import { budgetStatus, budgetTokensOf, entriesInWindow } from "../lib/token-budget";
import { toSettings } from "../lib/settings";
import { DateRange, billUnderContract, summarize, summarizeByProject } from "../lib/usage";

/**
 * Usage reporting and token budgets — see CLIENTS-INVOICING.md and
 * AGENT-WORKERS.md. Read-only: everything is computed from time entries.
 */
export const usageRouter = Router();
usageRouter.use(requireUserId);

interface SummaryQuery {
  from?: string;
  to?: string;
  areaId?: string;
  clientId?: string;
  contractId?: string;
}

function rangeFrom(query: SummaryQuery): DateRange {
  const { from, to } = query;
  if (!from || !to) throw badRequest("from and to are required");
  assertIsoDate(from, "from");
  assertIsoDate(to, "to");
  if (to < from) throw badRequest("to must not be before from");
  return { from, to };
}

/** Everything a summary is computed from, for one user and date range. */
async function loadUsageData(userId: string, range: DateRange) {
  const pk = userPk(userId);
  const [entries, projects, areas, contracts] = await Promise.all([
    queryByPk(pk, sortKeys.timeEntry.prefix),
    queryByPk(pk, sortKeys.project.prefix),
    queryByPk(pk, sortKeys.area.prefix),
    queryByPk(pk, sortKeys.contract.prefix),
  ]);
  return {
    entries: entries.filter((entry) => {
      const date = entry.date as string;
      return range.from <= date && date <= range.to;
    }),
    projects,
    areas,
    contracts,
  };
}

const idsOf = (items: TableItem[], key: SortKey) => new Set(items.map((item) => key.idOf(item)));
const hasSnapshotOf = (entry: TableItem, contractIds: Set<string>) =>
  ((entry.contractSnapshots as ContractSnapshot[] | undefined) ?? []).some((snapshot) =>
    contractIds.has(snapshot.contractId),
  );

/**
 * The slice of entries, projects and contracts a scope covers. An Area
 * covers its projects' work; a client or contract covers only the work
 * its contracts captured when it was logged.
 */
function applyScope(query: SummaryQuery, data: Awaited<ReturnType<typeof loadUsageData>>) {
  const scopes = [query.areaId, query.clientId, query.contractId].filter(Boolean);
  if (scopes.length > 1) throw badRequest("Use at most one of areaId, clientId and contractId");

  if (query.areaId) {
    const projects = data.projects.filter((project) =>
      ((project.areaIds as string[] | undefined) ?? []).includes(query.areaId as string),
    );
    const projectIds = idsOf(projects, sortKeys.project);
    return {
      entries: data.entries.filter((entry) => projectIds.has(entry.projectId as string)),
      projects,
      contracts: data.contracts.filter((contract) =>
        (contract.projectIds as string[]).some((id) => projectIds.has(id)),
      ),
    };
  }

  const contracts = data.contracts.filter((contract) =>
    query.contractId
      ? sortKeys.contract.idOf(contract) === query.contractId
      : contract.clientId === query.clientId,
  );
  const contractIds = idsOf(contracts, sortKeys.contract);
  const projectIds = new Set(contracts.flatMap((contract) => contract.projectIds as string[]));
  return {
    entries: data.entries.filter((entry) => hasSnapshotOf(entry, contractIds)),
    projects: data.projects.filter((project) => projectIds.has(sortKeys.project.idOf(project))),
    contracts,
  };
}

/** With no scope: usage per Area, and per billing kind so work vs. non-work is clear. */
function unscopedSummary(data: Awaited<ReturnType<typeof loadUsageData>>) {
  const areasById = new Map(data.areas.map((area) => [sortKeys.area.idOf(area), area]));
  const projectsById = new Map(data.projects.map((project) => [sortKeys.project.idOf(project), project]));
  const entriesForProjects = (projects: TableItem[]) => {
    const ids = idsOf(projects, sortKeys.project);
    return data.entries.filter((entry) => ids.has(entry.projectId as string));
  };

  const areas = data.areas.map((area) => {
    const areaId = sortKeys.area.idOf(area);
    const projects = data.projects.filter((project) =>
      ((project.areaIds as string[] | undefined) ?? []).includes(areaId),
    );
    return { areaId, name: area.name, kind: kindOf(area), totals: summarize(entriesForProjects(projects)) };
  });

  const byKind = Object.fromEntries(
    (["work", "project", "life", "unassigned"] as const).map((kind) => [
      kind,
      summarize(
        data.entries.filter((entry) => {
          const project = projectsById.get(entry.projectId as string);
          return project !== undefined && billingKindOf(project, areasById) === kind;
        }),
      ),
    ]),
  );
  return { areas, byKind };
}

usageRouter.get("/summary", async (req, res) => {
  const query = req.query as SummaryQuery;
  const range = rangeFrom(query);
  const data = await loadUsageData(req.userId, range);
  const isScoped = Boolean(query.areaId || query.clientId || query.contractId);
  const scoped = isScoped ? applyScope(query, data) : data;

  res.json({
    ...range,
    totals: summarize(scoped.entries),
    projects: summarizeByProject(scoped.entries, scoped.projects),
    contracts: scoped.contracts
      .filter((contract) => !contract.archived)
      .map((contract) => billUnderContract(contract, scoped.entries, range)),
    ...(!isScoped && unscopedSummary(data)),
  });
});

/** Used and remaining tokens per budget window, with each Area's share. */
usageRouter.get("/budget", async (req, res) => {
  const pk = userPk(req.userId);
  const [settingsItem, entries, projects, areas] = await Promise.all([
    getItem(pk, SETTINGS_SK),
    queryByPk(pk, sortKeys.timeEntry.prefix),
    queryByPk(pk, sortKeys.project.prefix),
    queryByPk(pk, sortKeys.area.prefix),
  ]);
  const settings = toSettings(settingsItem);
  const projectsById = new Map(projects.map((project) => [sortKeys.project.idOf(project), project]));
  const now = new Date();

  const budgets = settings.tokenBudgets.map((budget) => {
    const windowEntries = entriesInWindow(budget, entries, now);
    const areaUsage = areas
      .map((area) => {
        const areaId = sortKeys.area.idOf(area);
        const usedTokens = windowEntries
          .filter((entry) =>
            ((projectsById.get(entry.projectId as string)?.areaIds as string[] | undefined) ?? []).includes(areaId),
          )
          .reduce((sum, entry) => sum + budgetTokensOf(entry), 0);
        return { areaId, name: area.name, kind: kindOf(area), usedTokens };
      })
      .filter((area) => area.usedTokens > 0);
    return { ...budgetStatus(budget, entries, settings.budgetReservePercent, now), areas: areaUsage };
  });

  res.json({ reservePercent: settings.budgetReservePercent, budgets });
});
