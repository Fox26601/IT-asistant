import { cors } from "hono/cors";
import { config } from "../../config/env.js";

function allowedOrigins(): Set<string> {
  const set = new Set<string>();
  if (config.siteBaseUrl) set.add(config.siteBaseUrl);
  if (config.publicBaseUrl) set.add(config.publicBaseUrl);
  // Local dev
  set.add("http://localhost:3000");
  set.add("http://127.0.0.1:3000");
  set.add(`http://localhost:${config.port}`);
  set.add(`http://127.0.0.1:${config.port}`);
  return set;
}

/** Restrict browser CORS to site + agent origins. Server-to-server webhooks ignore CORS. */
export function createCorsMiddleware() {
  const origins = allowedOrigins();
  return cors({
    origin: (origin) => {
      if (!origin) return "";
      return origins.has(origin.replace(/\/$/, "")) ? origin : "";
    },
    allowMethods: ["GET", "POST", "OPTIONS", "HEAD"],
    allowHeaders: ["Content-Type", "x-webhook-secret", "Authorization"],
    maxAge: 86400,
  });
}
