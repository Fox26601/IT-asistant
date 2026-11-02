import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv() {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "sales-agent/.env"),
    resolve(import.meta.dirname, "../.env"),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
    break;
  }
}

loadDotEnv();

function required(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export const config = {
  telegramToken: required("TELEGRAM_BOT_TOKEN"),
  ownerChatId: required("OWNER_TELEGRAM_CHAT_ID"),
  botUsername: required("TELEGRAM_BOT_USERNAME"),
  telegramWebhookSecret:
    required("TELEGRAM_WEBHOOK_SECRET") ||
    required("WEBHOOK_SECRET", "change-me"),
  geminiApiKey: required("GEMINI_API_KEY"),
  geminiModel: required("GEMINI_MODEL", "gemini-2.0-flash"),
  port: Number(required("PORT", "3847")),
  webhookSecret: required("WEBHOOK_SECRET", "change-me"),
  publicBaseUrl: required("PUBLIC_BASE_URL", "http://localhost:3847").replace(
    /\/$/,
    ""
  ),
  googleClientId: required("GOOGLE_CLIENT_ID"),
  googleClientSecret: required("GOOGLE_CLIENT_SECRET"),
  googleRedirectUri: required(
    "GOOGLE_REDIRECT_URI",
    "http://localhost:3847/oauth/google/callback"
  ),
  googleRefreshToken: required("GOOGLE_REFRESH_TOKEN"),
  googleCalendarId: required("GOOGLE_CALENDAR_ID", "primary"),
  tz: required("TZ", "Europe/Kyiv"),
  allowMock: required("ALLOW_MOCK_INTEGRATIONS", "true") === "true",
  dataDir: resolve(import.meta.dirname, "../data"),
};

/** Production / Render: public HTTPS URL → Telegram webhook. Localhost → long polling. */
export function useTelegramWebhook(): boolean {
  const base = config.publicBaseUrl.toLowerCase();
  if (!base.startsWith("https://")) return false;
  if (base.includes("localhost") || base.includes("127.0.0.1")) return false;
  return true;
}

export function telegramWebhookPath(): string {
  return `/telegram/webhook/${config.telegramWebhookSecret}`;
}

export function telegramWebhookUrl(): string {
  return `${config.publicBaseUrl}${telegramWebhookPath()}`;
}

export function assertRuntimeConfig() {
  const missing: string[] = [];
  if (!config.telegramToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.geminiApiKey) missing.push("GEMINI_API_KEY");
  if (missing.length) {
    throw new Error(
      `Missing required env: ${missing.join(", ")}. Copy sales-agent/.env.example → .env`
    );
  }
}
