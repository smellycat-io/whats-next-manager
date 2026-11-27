/**
 * The request body as a plain object of optional fields. Express 5 leaves
 * `req.body` undefined when a request has no body.
 */
export function bodyOf<T extends object>(body: unknown): Partial<T> {
  return (body ?? {}) as Partial<T>;
}

/**
 * The listed fields that are present on `body` — what a PUT should write.
 * Fields left out of the request are left unchanged; anything not listed
 * is ignored, so a client can't write keys a route doesn't own.
 */
export function pickDefinedFields<T extends object>(
  body: Partial<T>,
  fields: readonly (keyof T & string)[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (body[field] !== undefined) picked[field] = body[field];
  }
  return picked;
}
