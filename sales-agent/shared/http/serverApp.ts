import type { Hono } from "hono";
import {
  assertRuntimeConfig,
  config,
  useTelegramWebhook,
} from "../../config/env.js";
import {
  clearTelegramWebhook,
  createClientBot,
  mountTelegramWebhook,
  registerTelegramWebhook,
} from "../../messaging/telegram.js";
import { createWebApp } from "./webApp.js";
import { pollEscalationsOnce } from "../../sales-manager/escalationPoller.js";
import {
  authorizeCron,
  authorizeWebhookSecret,
  unauthorized,
} from "../security/webhookAuth.js";
import { clientKey, rateLimit } from "../security/rateLimit.js";
import { redactSecrets, safeErrorDetail } from "../security/redact.js";

let telegramMounted = false;
let webhookRegisterPromise: Promise<void> | null = null;
let appSingleton: Hono | null = null;

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
      return c.json({
        ok: true,
        changed: result.changed,
        webhookUrl: `${config.publicBaseUrl}/telegram/webhook/…`,
      });
    } catch (err) {
      return c.json(
        {
          error: "set_webhook_failed",
          detail: safeErrorDetail(err),
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
    const rl = rateLimit(clientKey(c, "setup-telegram"), {
      limit: 5,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return c.json({ error: "rate_limited" }, 429);
    }
    if (!authorizeWebhookSecret(c)) return unauthorized(c);
    if (!telegramMounted) {
      return c.json(
        {
          error: "webhook_route_missing",
          detail:
            "Set PUBLIC_BASE_URL to https://… so Telegram webhook mounts.",
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
        path: "/telegram/webhook/…",
        publicBaseUrl: config.publicBaseUrl,
        webhookUrl: `${config.publicBaseUrl}/telegram/webhook/…`,
        changed: result.changed,
        telegramReportsUrl: info.url
          ? `${config.publicBaseUrl}/telegram/webhook/…`
          : null,
        pendingUpdateCount: info.pending_update_count,
        lastError: info.last_error_message
          ? redactSecrets(info.last_error_message)
          : null,
      });
    } catch (err) {
      console.error("[setup-telegram]", redactSecrets(err));
      return c.json(
        {
          error: "set_webhook_failed",
          detail: safeErrorDetail(err),
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
      console.error("[telegram] lazy setWebhook failed", redactSecrets(err));
    }
  })();
}

function botForLazyRegister(): ReturnType<typeof createClientBot> {
  return createClientBot();
}

export { clearTelegramWebhook, createClientBot, registerTelegramWebhook };
