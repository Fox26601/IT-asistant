import { Bot, Context, webhookCallback } from "grammy";
import type { Hono } from "hono";
import {
  config,
  telegramWebhookPath,
  telegramWebhookUrl,
} from "../config/env.js";
import {
  getOrCreateOpenSession,
  saveSession,
} from "../sales-manager/db/sessions.js";
import { handleUserTurn } from "../sales-manager/agent/dialogue.js";
import { describePhoto } from "../shared/media/photo.js";
import { transcribeAudio } from "../shared/media/audio.js";
import { resolveBotId, setOwnerChatOverride } from "./ownerChat.js";
import { authorizeTelegramSecretToken } from "../shared/security/webhookAuth.js";
import { redactSecrets } from "../shared/security/redact.js";

function safeWebhookLogUrl(): string {
  return `${config.publicBaseUrl}/telegram/webhook/…`;
}

export function createClientBot(): Bot {
  const bot = new Bot(config.telegramToken);

  /** Owner: DM /owner → saves your user chat.id for ops/lead notifies. */
  bot.command("owner", async (ctx) => {
    try {
      const chatId = ctx.chat?.id;
      const fromId = ctx.from?.id;
      if (!chatId || ctx.chat.type !== "private" || !fromId) {
        await ctx.reply("Run /owner in a private chat with this bot.");
        return;
      }
      const botId = await resolveBotId();
      if (botId && String(fromId) === botId) {
        await ctx.reply(
          "This chat is the bot itself — use your personal Telegram account."
        );
        return;
      }
      try {
        await setOwnerChatOverride(String(chatId));
      } catch (err) {
        console.error("[owner] persist failed", redactSecrets(err));
      }
      await ctx.reply(
        [
          "Owner chat registered for notifies.",
          `chat_id=${chatId}`,
          "Also set OWNER_TELEGRAM_CHAT_ID on Vercel (Project → Settings → Environment Variables) so it survives redeploy.",
        ].join("\n")
      );
    } catch (err) {
      console.error("[owner] handler failed", redactSecrets(err));
      try {
        await ctx.reply(
          "Could not finish /owner. Try again in a moment, or check Vercel logs."
        );
      } catch {
        /* ignore */
      }
    }
  });

  bot.command("start", async (ctx) => {
    const userId = String(ctx.from?.id || ctx.chat?.id);
    const session = await getOrCreateOpenSession("telegram", userId, {
      contact: ctx.from?.username ? `@${ctx.from.username}` : undefined,
      clientName: [ctx.from?.first_name, ctx.from?.last_name]
        .filter(Boolean)
        .join(" "),
    });
    const payload = ctx.match?.toString().trim();
    if (payload?.startsWith("web_")) {
      session.slots.notes =
        `${session.slots.notes || ""}\nLinked from web lead ${payload}`.trim();
      await saveSession(session);
    }
    const result = await handleUserTurn(
      session,
      "Client opened the bot with /start. Greet briefly and start qualifying their booking needs."
    );
    await ctx.reply(result.reply);
  });

  bot.command("status", async (ctx) => {
    const userId = String(ctx.from?.id || "");
    const session = await getOrCreateOpenSession("telegram", userId);
    await ctx.reply(
      `Session ${session.id}\nStatus: ${session.status}\nSlots: ${JSON.stringify(
        session.slots,
        null,
        2
      )}`
    );
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    await processText(ctx, ctx.message.text);
  });

  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message.photo;
    const best = photos[photos.length - 1];
    const file = await ctx.api.getFile(best.file_id);
    if (!file.file_path) {
      await ctx.reply("Couldn’t download that photo — please try again.");
      return;
    }
    // Token is required by Telegram file API; never log this URL.
    const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    await ctx.reply("Looking at your photo…");
    const description = await describePhoto({ url });
    const caption = ctx.message.caption?.trim();
    const userText = caption
      ? `[Photo] ${description}\nClient caption: ${caption}`
      : `[Photo] ${description}`;
    await processText(ctx, userText);
  });

  async function handleAudio(ctx: Context) {
    const voice = ctx.message?.voice || ctx.message?.audio;
    if (!voice) return;
    const file = await ctx.api.getFile(voice.file_id);
    if (!file.file_path) {
      await ctx.reply("Couldn’t download that audio — please try again.");
      return;
    }
    await ctx.reply("Listening…");
    const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = file.file_path.split(".").pop() || "ogg";
    const transcript = await transcribeAudio(buf, `voice.${ext}`);
    await processText(ctx, `[Voice transcript] ${transcript}`);
  }

  bot.on("message:voice", handleAudio);
  bot.on("message:audio", handleAudio);

  bot.catch((err) => {
    console.error("[telegram]", redactSecrets(err));
  });

  return bot;
}

/**
 * Mount Telegram updates (path secret + X-Telegram-Bot-Api-Secret-Token).
 * Path: /telegram/webhook/<TELEGRAM_WEBHOOK_SECRET>
 */
export function mountTelegramWebhook(app: Hono, bot: Bot): string {
  const path = telegramWebhookPath();
  const handleUpdate = webhookCallback(bot, "std/http");
  app.post(path, async (c) => {
    // Path already includes TELEGRAM_WEBHOOK_SECRET.
    // When Telegram sends X-Telegram-Bot-Api-Secret-Token (after setWebhook),
    // require it to match — reject spoofed headers without blocking the brief
    // window before secret_token is registered on a fresh deploy.
    const header = c.req.header("x-telegram-bot-api-secret-token")?.trim();
    if (header && !authorizeTelegramSecretToken(c)) {
      return c.text("unauthorized", 401);
    }
    try {
      return await handleUpdate(c.req.raw);
    } catch (err) {
      console.error("[telegram webhook]", redactSecrets(err));
      return c.text("webhook error", 500);
    }
  });
  return path;
}

/**
 * Point Telegram at PUBLIC_BASE_URL webhook. Idempotent.
 * Sets secret_token so Telegram sends X-Telegram-Bot-Api-Secret-Token.
 * Does NOT drop pending updates (avoids losing /owner while re-pointing).
 */
export async function registerTelegramWebhook(
  bot: Bot,
  opts: { dropPending?: boolean } = {}
): Promise<{ url: string; changed: boolean }> {
  const url = telegramWebhookUrl();
  let changed = true;
  try {
    const info = await bot.api.getWebhookInfo();
    if (info.url === url) changed = false;
  } catch {
    /* still setWebhook */
  }
  // Always setWebhook so secret_token stays applied after deploys.
  await bot.api.setWebhook(url, {
    drop_pending_updates: Boolean(opts.dropPending),
    secret_token: config.telegramWebhookSecret,
  });
  console.log(
    `[telegram] webhook ${changed ? "set" : "refreshed"} → ${safeWebhookLogUrl()}`
  );
  return { url, changed };
}

export async function clearTelegramWebhook(bot: Bot): Promise<void> {
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  console.log("[telegram] webhook cleared (long polling)");
}

async function processText(ctx: Context, text: string) {
  const userId = String(ctx.from?.id || ctx.chat?.id);
  const session = await getOrCreateOpenSession("telegram", userId, {
    contact: ctx.from?.username ? `@${ctx.from.username}` : undefined,
  });
  try {
    if (ctx.chat?.id) {
      await ctx.api.sendChatAction(ctx.chat.id, "typing");
    }
    const result = await handleUserTurn(session, text);
    await ctx.reply(result.reply);
  } catch (err) {
    console.error("[telegram turn]", redactSecrets(err));
    await ctx.reply(
      "Something went wrong on my side. Please send that again in a moment."
    );
  }
}
