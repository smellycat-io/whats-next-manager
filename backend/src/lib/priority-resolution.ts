import { getItem, userPk } from "../db/client";

/**
 * Default priority resolution shared by Tasks and (per ARCHITECTURE.md's
 * Goals tab structure) eventually Goals too: given a set of tagged Life
 * Area ids, find the highest-urgency one. Lower `order` = higher on the
 * Priority Ladder = more urgent (see ARCHITECTURE.md's Priority Ladder
 * screen) — Physiological is seeded at order 0, Self-Actualization at 4.
 *
 * Returns undefined if there's nothing to resolve from (no life areas,
 * or none of them have a defaultPriorityLevelId) — callers decide what
 * that means for them (e.g. leaving priorityLevelId unset).
 */
export async function resolveHighestUrgencyPriorityLevelId(
  userId: string,
  lifeAreaIds: string[],
): Promise<string | undefined> {
  if (lifeAreaIds.length === 0) return undefined;

  const pk = userPk(userId);
  const lifeAreas = await Promise.all(
    lifeAreaIds.map((id) => getItem(pk, `LIFE_AREA#${id}`)),
  );

  const priorityLevelIds = [
    ...new Set(
      lifeAreas
        .map((area) => area?.defaultPriorityLevelId as string | undefined)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (priorityLevelIds.length === 0) return undefined;

  const levels = await Promise.all(
    priorityLevelIds.map(async (id) => ({
      id,
      order: (await getItem(pk, `PRIORITY_LEVEL#${id}`))?.order as
        | number
        | undefined,
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
