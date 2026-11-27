import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Bot } from "grammy";
import { config } from "../config.js";
import { getMeta, setMeta } from "../db/pg.js";

const OWNER_META_KEY = "owner_telegram_chat_id";
const overridePath = resolve(config.dataDir, "owner-chat-id.txt");

let cachedBotId: string | null | undefined;
let runtimeOverride: string | null = null;

function readFileOverride(): string {
  try {
    if (!existsSync(overridePath)) return "";
    return readFileSync(overridePath, "utf8").trim();
  } catch {
    return "";
  }
}

export async function resolveBotId(): Promise<string | null> {
  if (cachedBotId !== undefined) return cachedBotId;
  if (!config.telegramToken) {
    cachedBotId = null;
    return null;
  }
  try {
    const bot = new Bot(config.telegramToken);
    const me = await bot.api.getMe();
    cachedBotId = String(me.id);
  } catch (err) {
    console.warn("[ownerChat] getMe failed", err);
    cachedBotId = null;
  }
  return cachedBotId;
}

/** Effective owner chat for notifies. Never returns the bot's own id. */
export async function resolveOwnerChatId(): Promise<string> {
  let pgOverride = "";
  try {
    if (config.databaseUrl) {
      pgOverride = await getMeta(OWNER_META_KEY);
    }
  } catch (err) {
    console.warn("[ownerChat] postgres meta read failed", err);
  }

  const candidates = [
    runtimeOverride,
    pgOverride,
    readFileOverride(),
    config.ownerChatId,
  ]
    .map((v) => (v || "").trim())
    .filter(Boolean);

  const botId = await resolveBotId();
  for (const id of candidates) {
    if (botId && id === botId) {
      console.warn(
        `[ownerChat] skipping bot id ${id} — OWNER_TELEGRAM_CHAT_ID must be your user chat id (DM /owner)`
      );
      continue;
    }
    return id;
  }
  return "";
}

export async function setOwnerChatOverride(chatId: string): Promise<void> {
  const id = chatId.trim();
  if (!id) throw new Error("empty chat id");
  runtimeOverride = id;
  try {
    if (config.databaseUrl) {
      await setMeta(OWNER_META_KEY, id);
    }
  } catch (err) {
    console.warn("[ownerChat] postgres meta write failed", err);
  }
  try {
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(overridePath, `${id}\n`, "utf8");
  } catch {
    /* /tmp may be unavailable in some runtimes — Postgres is source of truth */
  }
  console.log(
    `[ownerChat] override saved chat_id=${id} — also set OWNER_TELEGRAM_CHAT_ID on Vercel`
  );
}

export async function assertOwnerChatConfigured(): Promise<void> {
  const id = await resolveOwnerChatId();
  if (!id) {
    console.warn(
      "[ownerChat] no valid OWNER chat — owner notifies will fail until /owner or ENV fix"
    );
  } else {
    console.log(`[ownerChat] using chat_id=${id}`);
  }
}
