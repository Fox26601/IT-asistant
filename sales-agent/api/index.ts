import { handle } from "hono/vercel";
import { createServerApp } from "../src/serverApp.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

/** Build app sync — no Telegram/network I/O at module load (keeps /health fast). */
const app = createServerApp();
const handler = handle(app);

/** Vercel Node 22+/26 expects Web `fetch` method exports (not default Response). */
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
