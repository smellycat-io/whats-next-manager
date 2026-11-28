import { beforeEach, describe, expect, it, vi } from "vitest";
import { putItem } from "./db/client";
import { handler } from "./lambda";

vi.mock("./db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./db/client")>()),
  putItem: vi.fn(),
}));

/**
 * Runs requests through the real Lambda entry point, with the API Gateway
 * event shape serverless-http receives in production. Route tests use
 * supertest, which skips this adapter entirely.
 */
function apiGatewayEvent(method: string, path: string, body?: string, isBase64Encoded = false) {
  return {
    resource: "/{proxy+}",
    path,
    httpMethod: method,
    headers: { "Content-Type": "application/json" },
    multiValueHeaders: { "Content-Type": ["application/json"] },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    requestContext: { authorizer: { claims: { sub: "lambda-test-user" } } },
    body: body ?? null,
    isBase64Encoded,
  };
}

async function invoke(event: ReturnType<typeof apiGatewayEvent>) {
  const response = (await handler(event, {})) as { statusCode: number; body: string };
  return { statusCode: response.statusCode, body: JSON.parse(response.body) };
}

const NEW_AREA = JSON.stringify({ name: "PIN", kind: "work", defaultPriorityLevelId: "level" });

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Lambda handler", () => {
  it("parses a JSON request body", async () => {
    const response = await invoke(apiGatewayEvent("POST", "/areas", NEW_AREA));
    expect(response.statusCode).toBe(201);
    expect(response.body).toMatchObject({ name: "PIN", kind: "work" });
    expect(putItem).toHaveBeenCalledWith(expect.objectContaining({ pk: "USER#lambda-test-user" }));
  });

  it("parses a base64-encoded JSON body", async () => {
    const encoded = Buffer.from(NEW_AREA).toString("base64");
    const response = await invoke(apiGatewayEvent("POST", "/areas", encoded, true));
    expect(response.statusCode).toBe(201);
  });

  it("returns 400 for a malformed JSON body", async () => {
    const response = await invoke(apiGatewayEvent("POST", "/areas", "{not json"));
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toBe("Request body is not valid JSON");
  });
});
