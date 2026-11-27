import { handle } from "hono/vercel";
import {
  createServerApp,
  ensureTelegramWebhookRegistered,
} from "../src/serverApp.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

/** Build app sync — keep /health fast; re-assert Telegram webhook in background. */
const app = createServerApp();
ensureTelegramWebhookRegistered();
const handler = handle(app);

/** Vercel Node 22+/26 expects Web `fetch` method exports (not default Response). */
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
