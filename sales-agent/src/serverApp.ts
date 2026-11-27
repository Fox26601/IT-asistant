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

let telegramMounted = false;
let webhookRegisterPromise: Promise<void> | null = null;
let appSingleton: Hono | null = null;

function authorizeCron(c: {
  req: { header: (name: string) => string | undefined };
}): boolean {
  const secret = config.cronSecret;
  if (!secret) {
    return c.req.header("x-vercel-cron") === "1";
  }
  const auth = c.req.header("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  if (c.req.header("x-vercel-cron") === "1") return true;
  return false;
}

/**
 * Full HTTP app for Vercel serverless and for the Node server.
 * Telegram long-poll is NOT started here — only webhook routes.
 * Keep construction sync and free of network I/O so /health stays fast.
 */
export function createServerApp(): Hono {
  if (appSingleton) return appSingleton;

  assertRuntimeConfig();

  const app = createWebApp();
  const bot = createClientBot();

  if (useTelegramWebhook() || config.isVercel) {
    mountTelegramWebhook(app, bot);
    telegramMounted = true;
  }

  /** Re-assert webhook URL (guards against a legacy host stealing setWebhook). */
  app.get("/cron/telegram-webhook", async (c) => {
    if (!authorizeCron(c)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    try {
      const result = await registerTelegramWebhook(bot);
      return c.json({ ok: true, ...result });
    } catch (err) {
      return c.json(
        {
          error: "set_webhook_failed",
          detail: err instanceof Error ? err.message : String(err),
        },
        502
      );
    }
  });

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
      const result = await registerTelegramWebhook(bot);
      const me = await bot.api.getMe();
      const info = await bot.api.getWebhookInfo();
      return c.json({
        ok: true,
        bot: me.username,
        path: telegramWebhookPath(),
        publicBaseUrl: config.publicBaseUrl,
        webhookUrl: result.url,
        changed: result.changed,
        telegramReportsUrl: info.url || null,
        pendingUpdateCount: info.pending_update_count,
        lastError: info.last_error_message || null,
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

  appSingleton = app;
  return app;
}

/** Fire-and-forget setWebhook (never block request path / cold start). */
export function ensureTelegramWebhookRegistered(): void {
  if (!useTelegramWebhook() && !config.isVercel) return;
  if (webhookRegisterPromise) return;
  webhookRegisterPromise = (async () => {
    try {
      await registerTelegramWebhook(botForLazyRegister());
    } catch (err) {
      console.error("[telegram] lazy setWebhook failed", err);
    }
  })();
}

function botForLazyRegister(): ReturnType<typeof createClientBot> {
  return createClientBot();
}

export { clearTelegramWebhook, createClientBot, registerTelegramWebhook };
