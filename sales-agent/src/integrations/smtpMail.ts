import nodemailer from "nodemailer";
import { config } from "../config.js";

export type CorpMailPayload = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
};

export function smtpConfigured(): boolean {
  return Boolean(
    config.smtpHost &&
      config.smtpUser &&
      config.smtpPassword &&
      config.smtpFrom
  );
}

export function smtpStatus() {
  return {
    configured: smtpConfigured(),
    host: config.smtpHost || null,
    port: config.smtpPort,
    user: config.smtpUser || null,
    from: config.smtpFrom || null,
    tlsMode: config.smtpTlsMode,
  };
}

function useSecure(): boolean {
  if (config.smtpTlsMode === "ssl") return true;
  if (config.smtpTlsMode === "starttls" || config.smtpTlsMode === "plain") {
    return false;
  }
  return config.smtpPort === 465;
}

export async function sendCorpMail(payload: CorpMailPayload): Promise<{
  messageId: string;
}> {
  if (!smtpConfigured()) {
    throw new Error(
      "SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM on this service."
    );
  }
  const to = payload.to.trim();
  const subject = payload.subject.trim();
  const text = payload.text.trim();
  if (!to || !subject || !text) {
    throw new Error("to, subject, and text are required");
  }

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
    return { messageId: String(info.messageId || "") };
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
          `On Render Free, outbound SMTP (25/465/587) is blocked — upgrade IT-asistant to Starter ` +
          `(HornyFans already uses Starter and the same Gmail App Password works). ` +
          `Original: ${msg}`
      );
    }
    throw err;
  }
}
