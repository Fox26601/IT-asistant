import { ensureSchema, getSql } from "./pg.js";

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

export async function getOpenSession(
  channel: Session["channel"],
  externalUserId: string
): Promise<Session | null> {
  await ensureSchema();
  const rows = await getSql()`
    SELECT * FROM sessions
    WHERE channel = ${channel}
      AND external_user_id = ${externalUserId}
      AND status = 'open'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export async function getSessionById(id: string): Promise<Session | null> {
  await ensureSchema();
  const rows = await getSql()`
    SELECT * FROM sessions WHERE id = ${id} LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export async function createSession(
  channel: Session["channel"],
  externalUserId: string,
  initialSlots: DealSlots = {}
): Promise<Session> {
  await ensureSchema();
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
  const slotsJson = JSON.stringify(session.slots);
  const messagesJson = JSON.stringify(session.messages);
  await getSql()`
    INSERT INTO sessions
      (id, channel, external_user_id, status, slots_json, messages_json, calendar_event_id, created_at, updated_at)
    VALUES (
      ${session.id},
      ${session.channel},
      ${session.externalUserId},
      ${session.status},
      ${slotsJson},
      ${messagesJson},
      NULL,
      ${session.createdAt},
      ${session.updatedAt}
    )
  `;
  return session;
}

export async function saveSession(session: Session): Promise<void> {
  await ensureSchema();
  session.updatedAt = new Date().toISOString();
  const slotsJson = JSON.stringify(session.slots);
  const messagesJson = JSON.stringify(session.messages);
  const calendarEventId = session.calendarEventId ?? null;
  await getSql()`
    UPDATE sessions SET
      status = ${session.status},
      slots_json = ${slotsJson},
      messages_json = ${messagesJson},
      calendar_event_id = ${calendarEventId},
      updated_at = ${session.updatedAt}
    WHERE id = ${session.id}
  `;
}

export async function getOrCreateOpenSession(
  channel: Session["channel"],
  externalUserId: string,
  initialSlots: DealSlots = {}
): Promise<Session> {
  return (
    (await getOpenSession(channel, externalUserId)) ??
    (await createSession(channel, externalUserId, initialSlots))
  );
}
