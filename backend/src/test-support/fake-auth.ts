import { NextFunction, Request, Response } from "express";

/**
 * Stand-in for auth/current-user.ts in route tests, so they exercise
 * routing and data handling without building API Gateway events. Swap
 * it in with:
 *   vi.mock("../auth/current-user", () => import("../test-support/fake-auth"));
 * Send TEST_ACTOR_HEADER to simulate an agent acting on the test user's data.
 */
export const TEST_USER_ID = "test-user";
export const TEST_ACTOR_HEADER = "x-test-actor";

export function requireUserId(req: Request, _res: Response, next: NextFunction) {
  req.userId = TEST_USER_ID;
  req.actorUserId = req.get(TEST_ACTOR_HEADER) ?? TEST_USER_ID;
  next();
}
