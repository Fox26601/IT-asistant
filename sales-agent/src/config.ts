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
  geminiModel: required("GEMINI_MODEL", "gemini-3.8-flash"),
  port: Number(required("PORT", "3847")),
  webhookSecret: required("WEBHOOK_SECRET", "change-me"),
  publicBaseUrl: required("PUBLIC_BASE_URL", "http://localhost:3847").replace(
    /\/$/,
    ""
  ),
  siteBaseUrl: required(
    "SITE_BASE_URL",
    "https://symbolicpleasures.com"
  ).replace(/\/$/, ""),
  /** Same secret as site SALES_AGENT_WEBHOOK_SECRET; falls back to WEBHOOK_SECRET. */
  siteWebhookSecret:
    required("SITE_WEBHOOK_SECRET") ||
    required("WEBHOOK_SECRET", "change-me"),
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
  /**
   * Legacy local file dir (owner override fallback when Postgres unavailable).
   * Sessions/escalations use Postgres (DATABASE_URL / POSTGRES_URL).
   */
  dataDir: process.env.VERCEL
    ? "/tmp/sales-agent-data"
    : resolve(import.meta.dirname, "../data"),
  /** Neon / Vercel Postgres connection string. */
  databaseUrl:
    required("DATABASE_URL") || required("POSTGRES_URL"),
  /** True when running on Vercel serverless (no long-poll / no setInterval poller). */
  isVercel: Boolean(process.env.VERCEL),
  /** Protects /cron/* (Vercel Cron Authorization: Bearer CRON_SECRET). */
  cronSecret: required("CRON_SECRET"),
  /**
   * Prefer Resend HTTP on serverless (SMTP ports often blocked).
   * From address: MAIL_FROM or SMTP_FROM — bare address only, never SMTP_FROM_NAME.
   */
  resendApiKey: required("RESEND_API_KEY"),
  /** Corp outbound SMTP fallback (same SMTP_* names as site). Optional until set. */
  smtpHost: required("SMTP_HOST"),
  smtpPort: Number(required("SMTP_PORT", "587")) || 587,
  smtpUser: required("SMTP_USER"),
  smtpPassword: required("SMTP_PASSWORD"),
  /** Bare address only (e.g. kiniks@…); no display-name / SMTP_FROM_NAME. */
  smtpFrom: required("SMTP_FROM"),
  /** auto | starttls | ssl | plain — empty = auto (465→ssl, else starttls) */
  smtpTlsMode: required("SMTP_TLS_MODE", "auto").toLowerCase(),
  /**
   * Outbound From for Resend (and health display). Bare address only.
   * Falls back to SMTP_FROM. Do not set SMTP_FROM_NAME.
   */
  mailFrom: required("MAIL_FROM") || required("SMTP_FROM"),
};

/**
 * Production HTTPS URL → Telegram webhook.
 * Vercel always uses webhook (long-poll cannot run on serverless).
 * Localhost → long polling (Node process only).
 */
export function useTelegramWebhook(): boolean {
  if (config.isVercel) return true;
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
