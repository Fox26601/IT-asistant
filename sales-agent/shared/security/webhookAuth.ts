import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { config } from "../../config/env.js";

type HeaderReq = {
  req: {
    header: (name: string) => string | undefined;
    query: (name: string) => string | undefined;
  };
};

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Webhook auth for site → agent routes.
 * Header `x-webhook-secret` only — query `?secret=` is rejected (URL/query leaks in logs/proxies).
 */
export function authorizeWebhookSecret(
  c: HeaderReq,
  expected: string = config.webhookSecret
): boolean {
  if (!expected || expected === "change-me") return false;
  const header = c.req.header("x-webhook-secret")?.trim() || "";
  if (!header) return false;
  // Ignore query secret entirely (do not accept even if present).
  void c.req.query("secret");
  return safeEqual(header, expected);
}

export function unauthorized(c: Context) {
  return c.json({ error: "unauthorized" }, 401);
}

/** Vercel Cron: Authorization Bearer CRON_SECRET, or platform cron header when secret unset. */
export function authorizeCron(c: HeaderReq): boolean {
  const secret = config.cronSecret;
  if (!secret) {
    return c.req.header("x-vercel-cron") === "1";
  }
  const auth = c.req.header("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  if (c.req.header("x-vercel-cron") === "1") return true;
  return false;
}

/** Telegram Bot API secret_token header (set at setWebhook). */
export function authorizeTelegramSecretToken(
  c: HeaderReq,
  expected: string = config.telegramWebhookSecret
): boolean {
  if (!expected || expected === "change-me") return false;
  const header =
    c.req.header("x-telegram-bot-api-secret-token")?.trim() || "";
  if (!header) return false;
  return safeEqual(header, expected);
}
