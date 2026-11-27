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
    auth: {
      user: config.smtpUser,
      pass: config.smtpPassword,
    },
  });

  const info = await transporter.sendMail({
    from: config.smtpFrom,
    to,
    subject,
    text,
    replyTo: payload.replyTo?.trim() || config.smtpFrom,
  });

  return { messageId: String(info.messageId || "") };
}
