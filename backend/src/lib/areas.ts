import { TableItem, getItem, queryByPk, userPk } from "../db/client";
import { sortKeys } from "../db/keys";
import { badRequest } from "../http/errors";

/**
 * Area kinds decide billing (see CLIENTS-INVOICING.md): Work Areas are
 * billable through contracts; Life and Project Areas are tracked as the
 * user's own cost.
 */
export const AREA_KINDS = ["life", "work", "project"] as const;
export type AreaKind = (typeof AREA_KINDS)[number];
export const DEFAULT_AREA_KIND: AreaKind = "life";

function isAreaKind(value: unknown): value is AreaKind {
  return AREA_KINDS.includes(value as AreaKind);
}

export function kindOf(area: TableItem): AreaKind {
  return isAreaKind(area.kind) ? area.kind : DEFAULT_AREA_KIND;
}

/** The user's Areas with these ids. Ids with no Area are skipped. */
export async function getAreas(userId: string, areaIds: string[]): Promise<TableItem[]> {
  const pk = userPk(userId);
  const areas = await Promise.all(
    [...new Set(areaIds)].map((id) => getItem(pk, sortKeys.area.for(id))),
  );
  return areas.filter((area): area is TableItem => area !== undefined);
}

const ONE_WORK_AREA_MESSAGE =
  "A project or task can belong to at most one Work Area, so its work is never billed twice";

/** Rejects a set of Area tags that includes more than one Work Area. */
export async function assertAtMostOneWorkArea(userId: string, areaIds: string[]): Promise<void> {
  const areas = await getAreas(userId, areaIds);
  if (areas.filter((area) => kindOf(area) === "work").length > 1) {
    throw badRequest(ONE_WORK_AREA_MESSAGE);
  }
}

/**
 * Rejects turning an Area into a Work Area when some project or task is
 * already tagged with it and with another Work Area.
 */
export async function assertCanBecomeWorkArea(userId: string, areaId: string): Promise<void> {
  const pk = userPk(userId);
  const [areas, projects, tasks] = await Promise.all([
    queryByPk(pk, sortKeys.area.prefix),
    queryByPk(pk, sortKeys.project.prefix),
    queryByPk(pk, sortKeys.task.prefix),
  ]);

  const workAreaIds = new Set(
    areas.filter((area) => kindOf(area) === "work").map((area) => sortKeys.area.idOf(area)),
  );
  workAreaIds.add(areaId);

  const wouldHaveTwoWorkAreas = [...projects, ...tasks].some((item) => {
    const itemAreaIds = (item.areaIds as string[] | undefined) ?? [];
    return (
      itemAreaIds.includes(areaId) &&
      itemAreaIds.filter((id) => workAreaIds.has(id)).length > 1
    );
  });
  if (wouldHaveTwoWorkAreas) throw badRequest(ONE_WORK_AREA_MESSAGE);
}

/**
 * The kind that decides how a project's work counts: work if any of its
 * Areas is a Work Area, else project, else life, else unassigned. A
 * project can carry several Areas, but is billed as at most one kind.
 */
export function billingKindOf(project: TableItem, areasById: Map<string, TableItem>) {
  const kinds = ((project.areaIds as string[] | undefined) ?? [])
    .map((id) => areasById.get(id))
    .filter((area): area is TableItem => area !== undefined)
    .map(kindOf);
  return (["work", "project", "life"] as const).find((kind) => kinds.includes(kind)) ?? "unassigned";
}
