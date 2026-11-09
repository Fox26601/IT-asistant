import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config.js";

export type DealSlots = {
  need?: string;
  format?: string;
  budgetOrPackage?: string;
  preferredDateTime?: string;
  contact?: string;
  consentToBook?: boolean;
  notes?: string;
  clientName?: string;
  buyerGender?: string;
  buyerGenderCustom?: string;
  topic?: string;
  source?: string;
  page?: string;
  orderId?: string;
  customsRequestId?: string;
  meetingType?: string;
  service?: string;
  slot?: string;
  priceUsd?: number | string;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  at: string;
};

export type Session = {
  id: string;
  channel: "telegram" | "web";
  externalUserId: string;
  status: "open" | "booked" | "closed";
  slots: DealSlots;
  messages: ChatMessage[];
  calendarEventId?: string;
  createdAt: string;
  updatedAt: string;
};

mkdirSync(config.dataDir, { recursive: true });
const dbPath = resolve(config.dataDir, "sessions.sqlite");
/** Shared SQLite handle (sessions + escalations). */
export const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    slots_json TEXT NOT NULL,
    messages_json TEXT NOT NULL,
    calendar_event_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_channel_user
    ON sessions(channel, external_user_id);
`);

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: String(row.id),
    channel: row.channel as Session["channel"],
    externalUserId: String(row.external_user_id),
    status: row.status as Session["status"],
    slots: JSON.parse(String(row.slots_json || "{}")) as DealSlots,
    messages: JSON.parse(String(row.messages_json || "[]")) as ChatMessage[],
    calendarEventId: row.calendar_event_id
      ? String(row.calendar_event_id)
      : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getOpenSession(
  channel: Session["channel"],
  externalUserId: string
): Session | null {
  const row = db
    .prepare(
      `SELECT * FROM sessions
       WHERE channel = ? AND external_user_id = ? AND status = 'open'
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(channel, externalUserId) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function getSessionById(id: string): Session | null {
  const row = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function createSession(
  channel: Session["channel"],
  externalUserId: string,
  initialSlots: DealSlots = {}
): Session {
  const now = new Date().toISOString();
  const session: Session = {
    id: crypto.randomUUID(),
    channel,
    externalUserId,
    status: "open",
    slots: initialSlots,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  db.prepare(
    `INSERT INTO sessions
      (id, channel, external_user_id, status, slots_json, messages_json, calendar_event_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    session.id,
    session.channel,
    session.externalUserId,
    session.status,
    JSON.stringify(session.slots),
    JSON.stringify(session.messages),
    session.createdAt,
    session.updatedAt
  );
  return session;
}

export function saveSession(session: Session): void {
  session.updatedAt = new Date().toISOString();
  db.prepare(
    `UPDATE sessions SET
      status = ?,
      slots_json = ?,
      messages_json = ?,
      calendar_event_id = ?,
      updated_at = ?
     WHERE id = ?`
  ).run(
    session.status,
    JSON.stringify(session.slots),
    JSON.stringify(session.messages),
    session.calendarEventId ?? null,
    session.updatedAt,
    session.id
  );
}

export function getOrCreateOpenSession(
  channel: Session["channel"],
  externalUserId: string,
  initialSlots: DealSlots = {}
): Session {
  return (
    getOpenSession(channel, externalUserId) ??
    createSession(channel, externalUserId, initialSlots)
  );
}
