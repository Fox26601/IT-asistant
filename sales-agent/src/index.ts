import { serve } from "@hono/node-server";
import {
  assertRuntimeConfig,
  config,
  useTelegramWebhook,
} from "./config.js";
import {
  clearTelegramWebhook,
  createClientBot,
  mountTelegramWebhook,
  registerTelegramWebhook,
} from "./channels/telegram.js";
import { createWebApp } from "./channels/web.js";

async function main() {
  assertRuntimeConfig();

  const app = createWebApp();
  const bot = createClientBot();
  const webhookMode = useTelegramWebhook();

  if (webhookMode) {
    const path = mountTelegramWebhook(app, bot);
    console.log(`[telegram] HTTP webhook route ready: POST ${path}`);
  }

  serve({ fetch: app.fetch, port: config.port }, async (info) => {
    console.log(`[http] listening on port ${info.port}`);
    console.log(`[http] POST /webhooks/site-lead (header x-webhook-secret)`);
    console.log(`[http] PUBLIC_BASE_URL=${config.publicBaseUrl}`);

    if (!config.ownerChatId) {
      console.warn(
        "[telegram] Set OWNER_TELEGRAM_CHAT_ID so deal alerts reach you."
      );
    }

    if (webhookMode) {
      try {
        await registerTelegramWebhook(bot);
        const me = await bot.api.getMe();
        console.log(`[telegram] @${me.username} ready (webhook mode)`);
      } catch (err) {
        console.error("[telegram] failed to set webhook", err);
        process.exit(1);
      }
      return;
    }

    try {
      await clearTelegramWebhook(bot);
    } catch (err) {
      console.warn("[telegram] deleteWebhook warning", err);
    }
    console.log("[telegram] starting long polling…");
    bot.start({
      onStart: (info) => {
        console.log(`[telegram] @${info.username} ready (long polling)`);
      },
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
