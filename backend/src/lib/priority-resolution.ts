import { getItem, userPk } from "../db/client";
import { sortKeys } from "../db/keys";
import { getAreas } from "./areas";

/**
 * Default priority resolution shared by Tasks and (per ARCHITECTURE.md's
 * Goals tab structure) eventually Goals too: given a set of tagged Area
 * ids, find the highest-urgency one. Lower `order` = higher on the
 * Priority Ladder = more urgent (see ARCHITECTURE.md's Priority Ladder
 * screen) — Physiological is seeded at order 0, Self-Actualization at 4.
 *
 * Returns undefined if there's nothing to resolve from (no Areas, or none
 * of them have a defaultPriorityLevelId) — callers decide what that means
 * for them (e.g. leaving priorityLevelId unset).
 */
export async function resolveHighestUrgencyPriorityLevelId(
  userId: string,
  areaIds: string[],
): Promise<string | undefined> {
  const areas = await getAreas(userId, areaIds);

  const priorityLevelIds = [
    ...new Set(
      areas
        .map((area) => area.defaultPriorityLevelId as string | undefined)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (priorityLevelIds.length === 0) return undefined;

  const pk = userPk(userId);
  const levels = await Promise.all(
    priorityLevelIds.map(async (id) => ({
      id,
      order: (await getItem(pk, sortKeys.priorityLevel.for(id)))?.order as number | undefined,
    })),
  );

  const withOrder = levels.filter(
    (level): level is { id: string; order: number } => level.order !== undefined,
  );
  if (withOrder.length === 0) return undefined;

  return withOrder.reduce((highest, current) =>
    current.order < highest.order ? current : highest,
  ).id;
}
