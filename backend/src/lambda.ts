import serverlessHttp from "serverless-http";
import { createApp } from "./app";

/**
 * Lambda entry point — the only file that knows this is running behind
 * API Gateway. Everything else (app.ts, routes/) has no AWS dependency
 * and could run as a plain local server if needed.
 */
export const handler = serverlessHttp(createApp());
