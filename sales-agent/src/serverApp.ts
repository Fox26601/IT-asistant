import type { Hono } from "hono";
import {
  assertRuntimeConfig,
  config,
  telegramWebhookPath,
  useTelegramWebhook,
} from "./config.js";
import {
  clearTelegramWebhook,
  createClientBot,
  mountTelegramWebhook,
  registerTelegramWebhook,
} from "./channels/telegram.js";
import { createWebApp } from "./channels/web.js";
import { pollEscalationsOnce } from "./integrations/escalationPoller.js";
import { assertOwnerChatConfigured } from "./integrations/ownerChat.js";
import "./db/escalations.js";

let telegramMounted = false;
let webhookRegisterPromise: Promise<void> | null = null;

function authorizeCron(c: {
  req: { header: (name: string) => string | undefined };
}): boolean {
  const secret = config.cronSecret;
  if (!secret) {
    // Fallback: allow Vercel Cron header when CRON_SECRET unset (dev / first deploy).
    return c.req.header("x-vercel-cron") === "1";
  }
  const auth = c.req.header("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  // Vercel also sends x-vercel-cron on scheduled invocations.
  if (c.req.header("x-vercel-cron") === "1") return true;
  return false;
}

/**
 * Full HTTP app for Vercel serverless and for the Node server.
 * Telegram long-poll is NOT started here — only webhook routes.
 */
export function createServerApp(): Hono {
  assertRuntimeConfig();
  void assertOwnerChatConfigured();

  const app = createWebApp();
  const bot = createClientBot();

  if (useTelegramWebhook() || config.isVercel) {
    mountTelegramWebhook(app, bot);
    telegramMounted = true;
  }

  /** Vercel Cron: escalation follow-ups (replaces setInterval poller). */
  app.get("/cron/escalations", async (c) => {
    if (!authorizeCron(c)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await pollEscalationsOnce();
    return c.json({ ok: true });
  });
  app.post("/cron/escalations", async (c) => {
    if (!authorizeCron(c)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await pollEscalationsOnce();
    return c.json({ ok: true });
  });

  /**
   * One-shot: register Telegram webhook URL (after deploy / URL change).
   * Auth: x-webhook-secret. Safe to call repeatedly.
   */
  app.post("/webhooks/setup-telegram", async (c) => {
    const secret = c.req.header("x-webhook-secret") || c.req.query("secret");
    if (!secret || secret !== config.webhookSecret) {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (!telegramMounted) {
      return c.json(
        {
          error: "webhook_route_missing",
          detail: "Set PUBLIC_BASE_URL to https://… so Telegram webhook mounts.",
        },
        503
      );
    }
    try {
      await registerTelegramWebhook(bot);
      const me = await bot.api.getMe();
      return c.json({
        ok: true,
        bot: me.username,
        path: telegramWebhookPath(),
        publicBaseUrl: config.publicBaseUrl,
      });
    } catch (err) {
      console.error("[setup-telegram]", err);
      return c.json(
        {
          error: "set_webhook_failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        502
      );
    }
  });

  return app;
}

/** Lazily setWebhook once per isolate (best-effort on Vercel cold start). */
export function ensureTelegramWebhookRegistered(): void {
  if (!useTelegramWebhook() && !config.isVercel) return;
  if (webhookRegisterPromise) return;
  webhookRegisterPromise = (async () => {
    try {
      const bot = createClientBot();
      await registerTelegramWebhook(bot);
    } catch (err) {
      console.error("[telegram] lazy setWebhook failed", err);
    }
  })();
}

export { clearTelegramWebhook, createClientBot, registerTelegramWebhook };
