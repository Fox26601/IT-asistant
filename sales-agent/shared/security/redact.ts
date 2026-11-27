/** Patterns that must never appear in logs or error responses. */
const SECRET_PATTERNS: RegExp[] = [
  /bot\d{6,}:[A-Za-z0-9_-]{20,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /re_[A-Za-z0-9]{20,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /x-webhook-secret["'\s:=]+[^\s"',]+/gi,
  /postgresql:\/\/[^:\s]+:[^@\s]+@/gi,
  /TELEGRAM_BOT_TOKEN["'\s:=]+[^\s"',]+/gi,
  /GEMINI_API_KEY["'\s:=]+[^\s"',]+/gi,
  /WEBHOOK_SECRET["'\s:=]+[^\s"',]+/gi,
  /CRON_SECRET["'\s:=]+[^\s"',]+/gi,
  /SMTP_PASSWORD["'\s:=]+[^\s"',]+/gi,
  /GOOGLE_CLIENT_SECRET["'\s:=]+[^\s"',]+/gi,
  /GOOGLE_REFRESH_TOKEN["'\s:=]+[^\s"',]+/gi,
  /RESEND_API_KEY["'\s:=]+[^\s"',]+/gi,
];

export function redactSecrets(input: unknown): string {
  let text =
    typeof input === "string"
      ? input
      : input instanceof Error
        ? `${input.name}: ${input.message}`
        : String(input);
  for (const re of SECRET_PATTERNS) {
    text = text.replace(re, "[REDACTED]");
  }
  // Telegram file URLs embed the bot token in the path.
  text = text.replace(
    /https?:\/\/api\.telegram\.org\/file\/bot[^/\s]+/gi,
    "https://api.telegram.org/file/bot[REDACTED]"
  );
  return text;
}

export function safeErrorDetail(err: unknown): string {
  return redactSecrets(err instanceof Error ? err.message : String(err));
}
