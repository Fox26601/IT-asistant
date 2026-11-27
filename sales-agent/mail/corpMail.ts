import nodemailer from "nodemailer";
import { config } from "../config/env.js";

export type CorpMailPayload = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
};

export type MailProvider = "resend" | "smtp";

export function resendConfigured(): boolean {
  return Boolean(config.resendApiKey && config.mailFrom);
}

export function smtpConfigured(): boolean {
  return Boolean(
    config.smtpHost &&
      config.smtpUser &&
      config.smtpPassword &&
      config.smtpFrom
  );
}

/** Prefer Resend HTTP when keyed; SMTP remains fallback. */
export function mailConfigured(): boolean {
  return resendConfigured() || smtpConfigured();
}

export function preferredMailProvider(): MailProvider | null {
  if (resendConfigured()) return "resend";
  if (smtpConfigured()) return "smtp";
  return null;
}

export function mailStatus() {
  const provider = preferredMailProvider();
  return {
    configured: mailConfigured(),
    provider,
    from: config.mailFrom || null,
    resend: {
      configured: resendConfigured(),
      hasApiKey: Boolean(config.resendApiKey),
    },
    smtp: {
      configured: smtpConfigured(),
      host: config.smtpHost || null,
      port: config.smtpPort,
      user: config.smtpUser || null,
      from: config.smtpFrom || null,
      tlsMode: config.smtpTlsMode,
    },
  };
}

/** @deprecated use mailStatus — kept for older smoke scripts */
export function smtpStatus() {
  const m = mailStatus();
  return {
    configured: m.configured,
    provider: m.provider,
    host: m.smtp.host,
    port: m.smtp.port,
    user: m.smtp.user,
    from: m.from,
    tlsMode: m.smtp.tlsMode,
    resend: m.resend.configured,
  };
}

function useSecure(): boolean {
  if (config.smtpTlsMode === "ssl") return true;
  if (config.smtpTlsMode === "starttls" || config.smtpTlsMode === "plain") {
    return false;
  }
  return config.smtpPort === 465;
}

async function sendViaResend(payload: CorpMailPayload): Promise<{
  messageId: string;
  provider: "resend";
}> {
  const to = payload.to.trim();
  const subject = payload.subject.trim();
  const text = payload.text.trim();
  const from = config.mailFrom;
  const replyTo = payload.replyTo?.trim() || from;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      reply_to: replyTo,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    name?: string;
    error?: { message?: string };
  };

  if (!res.ok) {
    const detail =
      body.error?.message ||
      body.message ||
      body.name ||
      JSON.stringify(body) ||
      res.statusText;
    throw new Error(`Resend send failed (${res.status}): ${detail}`);
  }

  return { messageId: String(body.id || ""), provider: "resend" };
}

async function sendViaSmtp(payload: CorpMailPayload): Promise<{
  messageId: string;
  provider: "smtp";
}> {
  if (!smtpConfigured()) {
    throw new Error(
      "SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM — or prefer RESEND_API_KEY + MAIL_FROM / SMTP_FROM."
    );
  }
  const to = payload.to.trim();
  const subject = payload.subject.trim();
  const text = payload.text.trim();

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: useSecure(),
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPassword,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: config.smtpFrom,
      to,
      subject,
      text,
      replyTo: payload.replyTo?.trim() || config.smtpFrom,
    });
    return { messageId: String(info.messageId || ""), provider: "smtp" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code || "")
        : "";
    if (
      code === "ETIMEDOUT" ||
      /timeout|ETIMEDOUT|ECONNREFUSED/i.test(msg)
    ) {
      throw new Error(
        `SMTP connect failed (${config.smtpHost}:${config.smtpPort}, ${code || msg}). ` +
          `Serverless hosts often block outbound SMTP (25/465/587) — set RESEND_API_KEY and use Resend HTTP instead. ` +
          `Original: ${msg}`
      );
    }
    throw err;
  }
}

export async function sendCorpMail(payload: CorpMailPayload): Promise<{
  messageId: string;
  provider: MailProvider;
}> {
  const to = payload.to.trim();
  const subject = payload.subject.trim();
  const text = payload.text.trim();
  if (!to || !subject || !text) {
    throw new Error("to, subject, and text are required");
  }
  if (!mailConfigured()) {
    throw new Error(
      "Mail not configured. Prefer RESEND_API_KEY + MAIL_FROM (or SMTP_FROM). SMTP_* remains a fallback."
    );
  }

  if (resendConfigured()) {
    return sendViaResend(payload);
  }
  return sendViaSmtp(payload);
}
