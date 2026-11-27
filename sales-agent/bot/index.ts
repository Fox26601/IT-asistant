import { serve } from "@hono/node-server";
import {
  assertRuntimeConfig,
  config,
  useTelegramWebhook,
} from "../config/env.js";
import {
  clearTelegramWebhook,
  createClientBot,
  createServerApp,
  registerTelegramWebhook,
} from "../shared/http/serverApp.js";
import { startEscalationPoller } from "../sales-manager/escalationPoller.js";
import { assertOwnerChatConfigured } from "../messaging/ownerChat.js";
import { ensureSchema } from "../shared/db/pg.js";

async function main() {
  assertRuntimeConfig();

  if (config.isVercel) {
    throw new Error(
      "bot/index.ts is the Node/Docker entry. On Vercel use api/index.ts (serverless)."
    );
  }

  await ensureSchema();
  await assertOwnerChatConfigured();

  const app = createServerApp();
  const bot = createClientBot();
  const webhookMode = useTelegramWebhook();

  serve({ fetch: app.fetch, port: config.port }, async (info) => {
    console.log(`[http] listening on port ${info.port}`);
    console.log(`[http] POST /webhooks/site-lead (header x-webhook-secret)`);
    console.log(`[http] POST /webhooks/ops-alert (header x-webhook-secret)`);
    console.log(`[http] POST /webhooks/corp-mail (header x-webhook-secret)`);
    console.log(`[http] GET|POST /cron/escalations`);
    console.log(`[http] PUBLIC_BASE_URL=${config.publicBaseUrl}`);
    startEscalationPoller();

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
