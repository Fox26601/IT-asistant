import { handle } from "hono/vercel";
import { createServerApp } from "../src/serverApp.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

/** Build app sync — no Telegram/network I/O at module load (keeps /health fast). */
const app = createServerApp();

export default handle(app);
