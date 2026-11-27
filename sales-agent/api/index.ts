import { handle } from "hono/vercel";
import {
  createServerApp,
  ensureTelegramWebhookRegistered,
} from "../src/serverApp.js";

export const config = {
  runtime: "nodejs",
  maxDuration: 60,
};

const app = createServerApp();
ensureTelegramWebhookRegistered();

export default handle(app);
