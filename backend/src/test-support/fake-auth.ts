import { NextFunction, Request, Response } from "express";

/**
 * Stand-in for auth/current-user.ts in route tests, so they exercise
 * routing and data handling without building API Gateway events. Swap
 * it in with:
 *   vi.mock("../auth/current-user", () => import("../test-support/fake-auth"));
 */
export const TEST_USER_ID = "test-user";

export function requireUserId(req: Request, _res: Response, next: NextFunction) {
  req.userId = TEST_USER_ID;
  next();
}
