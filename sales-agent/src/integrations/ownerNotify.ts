import { Bot } from "grammy";
import { config } from "../config.js";
import type { DealSlots } from "../db/sessions.js";

let bot: Bot | null = null;

function getBot() {
  if (!config.telegramToken) return null;
  if (!bot) bot = new Bot(config.telegramToken);
  return bot;
}

export async function notifyOwnerDeal(input: {
  sessionId: string;
  channel: string;
  externalUserId: string;
  slots: DealSlots;
  calendarEventId?: string;
  calendarLink?: string;
  mockCalendar?: boolean;
}): Promise<void> {
  const text = [
    "🆕 New booking request",
    `Session: ${input.sessionId}`,
    `Channel: ${input.channel} / ${input.externalUserId}`,
    `Name: ${input.slots.clientName || "—"}`,
    `Need: ${input.slots.need || "—"}`,
    `Format: ${input.slots.format || "—"}`,
    `Budget: ${input.slots.budgetOrPackage || "—"}`,
    `When: ${input.slots.preferredDateTime || "—"}`,
    `Contact: ${input.slots.contact || "—"}`,
    `Notes: ${input.slots.notes || "—"}`,
    input.mockCalendar
      ? `Calendar: MOCK (${input.calendarEventId})`
      : `Calendar: ${input.calendarEventId || "—"}`,
    input.calendarLink ? `Link: ${input.calendarLink}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (!config.ownerChatId) {
    console.warn("[ownerNotify] OWNER_TELEGRAM_CHAT_ID missing — logging only");
    console.log(text);
    return;
  }

  const b = getBot();
  if (!b) {
    console.warn("[ownerNotify] no bot token — logging only");
    console.log(text);
    return;
  }

  try {
    await b.api.sendMessage(config.ownerChatId, text);
  } catch (err) {
    console.error("[ownerNotify] sendMessage failed", err);
  }
}

export async function notifyOwnerLead(input: {
  sessionId: string;
  name?: string;
  contact?: string;
  message?: string;
  handoffUrl?: string;
}): Promise<void> {
  const text = [
    "🌐 New web lead",
    `Session: ${input.sessionId}`,
    `Name: ${input.name || "—"}`,
    `Contact: ${input.contact || "—"}`,
    `Message: ${input.message || "—"}`,
    input.handoffUrl ? `Continue in Telegram: ${input.handoffUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (!config.ownerChatId || !config.telegramToken) {
    console.log(text);
    return;
  }
  const b = getBot();
  if (!b) {
    console.log(text);
    return;
  }
  try {
    await b.api.sendMessage(config.ownerChatId, text);
  } catch (err) {
    console.error("[ownerNotify] lead notify failed", err);
  }
}

/** Send a message to a Telegram buyer chat id (externalUserId). */
export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<boolean> {
  const b = getBot();
  if (!b) {
    console.warn("[telegramSend] no bot token");
    return false;
  }
  try {
    await b.api.sendMessage(chatId, text);
    return true;
  } catch (err) {
    console.error("[telegramSend] sendMessage failed", err);
    return false;
  }
}

export async function notifyOwnerEscalationAnswer(input: {
  sessionId: string;
  channel: string;
  escalationId: string;
  question: string;
  answer: string;
  deliveredToBuyer: boolean;
}): Promise<void> {
  const text = [
    "✅ Operator escalation answered",
    `Session: ${input.sessionId}`,
    `Channel: ${input.channel}`,
    `Escalation: ${input.escalationId}`,
    `Q: ${input.question}`,
    `A: ${input.answer.slice(0, 800)}`,
    input.deliveredToBuyer
      ? "Delivered to buyer (Telegram)."
      : "Stored on session / owner-only (web or delivery failed).",
  ].join("\n");

  if (!config.ownerChatId || !config.telegramToken) {
    console.log(text);
    return;
  }
  const b = getBot();
  if (!b) {
    console.log(text);
    return;
  }
  try {
    await b.api.sendMessage(config.ownerChatId, text);
  } catch (err) {
    console.error("[ownerNotify] escalation notify failed", err);
  }
}

export type OpsAlertInput = {
  severity: string;
  code: string;
  fingerprint?: string;
  count?: number;
  text: string;
  meta?: Record<string, unknown>;
};

/** Site → ops-alert webhook → owner Telegram (Russian text from site). */
export async function notifyOwnerOpsAlert(
  input: OpsAlertInput
): Promise<boolean> {
  const severity = (input.severity || "P1").trim().toUpperCase() || "P1";
  const code = (input.code || "ops.unknown").trim() || "ops.unknown";
  const count =
    typeof input.count === "number" && input.count > 1
      ? ` ×${Math.floor(input.count)}`
      : "";
  const emoji =
    severity === "P0" ? "🚨" : severity === "P2" ? "⚠️" : "🔔";
  const lines = [
    `${emoji} [${severity}] ${code}${count}`,
    input.text.trim(),
  ];
  const fp = (input.fingerprint || "").trim();
  if (fp) lines.push(`fingerprint: ${fp}`);
  const meta = input.meta;
  if (meta && typeof meta === "object") {
    const rid = meta.request_id ?? meta.requestId;
    const path = meta.path;
    if (rid != null && String(rid).trim()) {
      lines.push(`request_id=${String(rid).trim()}`);
    }
    if (path != null && String(path).trim()) {
      lines.push(`path=${String(path).trim()}`);
    }
  }
  const text = lines.filter(Boolean).join("\n").slice(0, 3500);

  if (!config.ownerChatId || !config.telegramToken) {
    console.warn("[ownerNotify] ops-alert — logging only (no owner chat/token)");
    console.log(text);
    return true;
  }
  const b = getBot();
  if (!b) {
    console.log(text);
    return true;
  }
  try {
    await b.api.sendMessage(config.ownerChatId, text);
    return true;
  } catch (err) {
    console.error("[ownerNotify] ops-alert send failed", err);
    return false;
  }
}
