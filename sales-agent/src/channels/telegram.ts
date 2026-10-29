import { Bot, Context, webhookCallback } from "grammy";
import type { Hono } from "hono";
import {
  config,
  telegramWebhookPath,
  telegramWebhookUrl,
} from "../config.js";
import { getOrCreateOpenSession, saveSession } from "../db/sessions.js";
import { handleUserTurn } from "../agent/dialogue.js";
import { describePhoto } from "../media/photo.js";
import { transcribeAudio } from "../media/audio.js";

export function createClientBot(): Bot {
  const bot = new Bot(config.telegramToken);

  bot.command("start", async (ctx) => {
    const userId = String(ctx.from?.id || ctx.chat?.id);
    const session = getOrCreateOpenSession("telegram", userId, {
      contact: ctx.from?.username ? `@${ctx.from.username}` : undefined,
      clientName: [ctx.from?.first_name, ctx.from?.last_name]
        .filter(Boolean)
        .join(" "),
    });
    const payload = ctx.match?.toString().trim();
    if (payload?.startsWith("web_")) {
      // Deep-link from website: web_<sessionId>
      session.slots.notes =
        `${session.slots.notes || ""}\nLinked from web lead ${payload}`.trim();
      saveSession(session);
    }
    const result = await handleUserTurn(
      session,
      "Client opened the bot with /start. Greet briefly and start qualifying their booking needs."
    );
    await ctx.reply(result.reply);
  });

  bot.command("status", async (ctx) => {
    const userId = String(ctx.from?.id || "");
    const session = getOrCreateOpenSession("telegram", userId);
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
    console.error("[telegram]", err);
  });

  return bot;
}

/** Mount Telegram updates on the HTTP app (Render / production). */
export function mountTelegramWebhook(app: Hono, bot: Bot): string {
  const path = telegramWebhookPath();
  const handleUpdate = webhookCallback(bot, "std/http");
  app.post(path, async (c) => {
    try {
      return await handleUpdate(c.req.raw);
    } catch (err) {
      console.error("[telegram webhook]", err);
      return c.text("webhook error", 500);
    }
  });
  return path;
}

export async function registerTelegramWebhook(bot: Bot): Promise<void> {
  const url = telegramWebhookUrl();
  await bot.api.setWebhook(url, {
    drop_pending_updates: true,
    secret_token: undefined,
  });
  console.log(`[telegram] webhook set → ${url}`);
}

export async function clearTelegramWebhook(bot: Bot): Promise<void> {
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  console.log("[telegram] webhook cleared (long polling)");
}

async function processText(ctx: Context, text: string) {
  const userId = String(ctx.from?.id || ctx.chat?.id);
  const session = getOrCreateOpenSession("telegram", userId, {
    contact: ctx.from?.username ? `@${ctx.from.username}` : undefined,
  });
  try {
    if (ctx.chat?.id) {
      await ctx.api.sendChatAction(ctx.chat.id, "typing");
    }
    const result = await handleUserTurn(session, text);
    await ctx.reply(result.reply);
  } catch (err) {
    console.error("[telegram turn]", err);
    await ctx.reply(
      "Something went wrong on my side. Please send that again in a moment."
    );
  }
}
