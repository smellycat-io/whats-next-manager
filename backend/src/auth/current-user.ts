import { NextFunction, Request, Response } from "express";
import { forbidden, unauthorized } from "../http/errors";
import { ACT_AS_USER_HEADER, hasDelegation, isAllowedForDelegate } from "./delegation";

declare module "express-serve-static-core" {
  interface Request {
    /** Whose data this request reads and writes. */
    userId: string;
    /** Who made the request: the same as userId, or an agent's service user. */
    actorUserId: string;
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
 * Sets `req.userId` and `req.actorUserId` for the authenticated caller,
 * or rejects the request. Every resource router mounts this first (per
 * WORKSPACES.md's call for a single shared auth utility).
 *
 * - No verified claims → 401. API Gateway already rejects unauthenticated
 *   requests on these routes; this is the backstop for any path that
 *   reaches the Lambda without the authorizer, such as an OPTIONS request.
 * - An act-as header naming another user → the caller must be that user's
 *   delegate, on an allowed route (see delegation.ts), or 403. The header
 *   grants nothing on its own: it's only read after the token is verified.
 */
export async function requireUserId(req: Request, _res: Response, next: NextFunction) {
  const callerId = verifiedCognitoSub(req);
  if (!callerId) throw unauthorized();

  const actAsUserId = req.get(ACT_AS_USER_HEADER);
  if (actAsUserId && actAsUserId !== callerId) {
    if (!isAllowedForDelegate(req.method, req.baseUrl)) throw forbidden();
    if (!(await hasDelegation(actAsUserId, callerId))) throw forbidden();
    req.userId = actAsUserId;
  } else {
    req.userId = callerId;
  }
  req.actorUserId = callerId;
  next();
}
