import { NextFunction, Request, Response } from "express";
import { badRequest } from "./errors";

/**
 * serverless-http hands Express the Lambda event's body as an already-read
 * Buffer on `req.body`. express.json() skips it, because the request stream
 * has nothing left to read, so without this every route would see a
 * Buffer instead of the parsed object. Runs after express.json(), so a
 * plain HTTP server (tests, local runs) is unaffected.
 */
export function parseLambdaJsonBody(req: Request, _res: Response, next: NextFunction) {
  if (Buffer.isBuffer(req.body)) {
    const text = req.body.toString("utf8");
    if (text.length === 0) {
      req.body = undefined;
    } else if (req.is("application/json")) {
      try {
        req.body = JSON.parse(text);
      } catch {
        throw badRequest("Request body is not valid JSON");
      }
    }
  }
  next();
}
