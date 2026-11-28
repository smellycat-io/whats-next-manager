import { getItem, userPk } from "../db/client";
import { sortKeys } from "../db/keys";

/**
 * Delegated access for agent workers — see AGENT-WORKERS.md. A service
 * user acts on an owner's data by sending ACT_AS_USER_HEADER, honored only
 * when the owner has a DELEGATE record for that service user, and only on
 * the routes below.
 */
export const ACT_AS_USER_HEADER = "x-act-as-user";

/**
 * HTTP methods a delegate may use, by router mount path. Anything not
 * listed is refused, so a misbehaving agent can't reach budget, journal,
 * calendar or settings data, or delete anything. Routers that don't
 * exist yet are added here when they're built.
 */
const DELEGATE_ALLOWED_METHODS: Readonly<Record<string, readonly string[]>> = {
  "/tasks": ["GET", "POST", "PUT"],
  "/areas": ["GET"],
  "/projects": ["GET"],
  "/priority-levels": ["GET"],
};

export function isAllowedForDelegate(method: string, routerPath: string): boolean {
  return DELEGATE_ALLOWED_METHODS[routerPath]?.includes(method) ?? false;
}

export async function hasDelegation(
  ownerUserId: string,
  serviceUserId: string,
): Promise<boolean> {
  return (await getItem(userPk(ownerUserId), sortKeys.delegate.for(serviceUserId))) !== undefined;
}
