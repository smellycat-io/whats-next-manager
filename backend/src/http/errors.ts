import { ErrorRequestHandler } from "express";

/**
 * An error that maps to a specific HTTP status. Route handlers throw
 * these instead of writing error responses themselves; `errorHandler`
 * turns them into the shared `{ status: "error", message }` shape.
 */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function notFound(resourceName: string): HttpError {
  return new HttpError(404, `${resourceName} not found`);
}

/**
 * Express 5 forwards rejected promises from async handlers to error
 * middleware, so routes don't wrap every handler in try/catch. Errors
 * carrying a 4xx status keep it: HttpError, and express.json()'s error for
 * a malformed body. Everything else is a 500.
 */
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  res.status(clientErrorStatus(error) ?? 500).json({
    status: "error",
    message: error instanceof Error ? error.message : String(error),
  });
};

function clientErrorStatus(error: unknown): number | undefined {
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof statusCode === "number" && statusCode >= 400 && statusCode < 500
    ? statusCode
    : undefined;
}
