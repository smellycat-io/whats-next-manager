import { NextFunction, Request, Response } from "express";

declare module "express-serve-static-core" {
  interface Request {
    userId: string;
  }
}

/**
 * The slice of the API Gateway event this module reads. serverless-http
 * attaches the original event to the request as `req.apiGateway.event`.
 * Tests and local runs mock this object; there is no auth-bypass mode.
 */
interface ApiGatewayRequestContext {
  apiGateway?: {
    event?: {
      requestContext?: {
        authorizer?: { claims?: Record<string, unknown> } | null;
      };
    };
  };
}

/**
 * The verified Cognito `sub` of the caller, or undefined if absent.
 * The claims are only present after API Gateway's Cognito authorizer
 * has validated the access token (see api-construct.ts), so nothing a
 * client sends in headers or the body can set them.
 */
function verifiedCognitoSub(req: Request): string | undefined {
  const sub = (req as Request & ApiGatewayRequestContext).apiGateway?.event
    ?.requestContext?.authorizer?.claims?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : undefined;
}

/**
 * Attaches the authenticated user's id to the request as `req.userId`,
 * or responds 401 when there are no verified claims. Every resource
 * router mounts this first (per WORKSPACES.md's call for a single shared
 * auth utility). API Gateway already rejects unauthenticated requests on
 * these routes; this check is the backstop for any path that reaches the
 * Lambda without the authorizer, such as an unauthenticated OPTIONS.
 */
export function requireUserId(req: Request, res: Response, next: NextFunction) {
  const userId = verifiedCognitoSub(req);
  if (!userId) {
    res.status(401).json({ status: "error", message: "Unauthorized" });
    return;
  }
  req.userId = userId;
  next();
}
