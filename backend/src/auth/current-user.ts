import { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    userId: string;
  }
}

/**
 * Attaches the authenticated user's id to the request as `req.userId`.
 *
 * Placeholder until API Gateway's Cognito authorizer is actually wired up
 * (see ARCHITECTURE.md Backend — not done yet): reads a client-supplied
 * header instead of a verified JWT claim. Once the authorizer exists,
 * swap the body for reading the verified `sub` claim off the API Gateway
 * proxy event (available via `req.apiGateway.event.requestContext
 * .authorizer.claims.sub` through serverless-http) — every router already
 * depends only on `req.userId`, so that swap happens in this one place.
 *
 * Every resource router mounts this first (per WORKSPACES.md's call for a
 * single shared auth utility rather than reimplementing this per route).
 */
export function requireUserId(req: Request, res: Response, next: NextFunction) {
  const userId = req.header("x-user-id");
  if (!userId) {
    res.status(401).json({ status: "error", message: "Missing x-user-id header" });
    return;
  }
  req.userId = userId;
  next();
}
