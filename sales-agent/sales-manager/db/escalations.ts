import { ensureSchema, getSql } from "../../shared/db/pg.js";

export type EscalationRecord = {
  escalationId: string;
  sessionId: string;
  question: string;
  status: "pending" | "answered" | "dismissed" | "delivered" | "failed";
  answer?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
};

function rowToRecord(row: Record<string, unknown>): EscalationRecord {
  return {
    escalationId: String(row.escalation_id),
    sessionId: String(row.session_id),
    question: String(row.question || ""),
    status: String(row.status) as EscalationRecord["status"],
    answer: row.answer ? String(row.answer) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deliveredAt: row.delivered_at ? String(row.delivered_at) : undefined,
  };
}

export async function trackEscalation(input: {
  escalationId: string;
  sessionId: string;
  question: string;
}): Promise<EscalationRecord> {
  await ensureSchema();
  const now = new Date().toISOString();
  await getSql()`
    INSERT INTO escalations
      (escalation_id, session_id, question, status, answer, created_at, updated_at, delivered_at)
    VALUES (
      ${input.escalationId},
      ${input.sessionId},
      ${input.question},
      'pending',
      NULL,
      ${now},
      ${now},
      NULL
    )
    ON CONFLICT (escalation_id, session_id) DO UPDATE SET
      question = EXCLUDED.question,
      status = CASE
        WHEN escalations.status IN ('delivered', 'answered', 'dismissed') THEN escalations.status
        ELSE 'pending'
      END,
      updated_at = EXCLUDED.updated_at
  `;

  return (
    (await getEscalation(input.escalationId, input.sessionId)) || {
      escalationId: input.escalationId,
      sessionId: input.sessionId,
      question: input.question,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }
  );
}

export async function getEscalation(
  escalationId: string,
  sessionId: string
): Promise<EscalationRecord | null> {
  await ensureSchema();
  const rows = await getSql()`
    SELECT * FROM escalations
    WHERE escalation_id = ${escalationId} AND session_id = ${sessionId}
    LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? rowToRecord(row) : null;
}

export async function listPendingEscalations(): Promise<EscalationRecord[]> {
  await ensureSchema();
  const rows = await getSql()`
    SELECT * FROM escalations
    WHERE status IN ('pending', 'answered')
    ORDER BY created_at ASC
  `;
  return (rows as Record<string, unknown>[]).map(rowToRecord);
}

export async function listPendingEscalationIds(): Promise<string[]> {
  await ensureSchema();
  const rows = await getSql()`
    SELECT DISTINCT escalation_id FROM escalations
    WHERE status = 'pending'
  `;
  return (rows as { escalation_id: string }[]).map((r) =>
    String(r.escalation_id)
  );
}

export async function listPendingEscalationIdsForSession(
  sessionId: string
): Promise<string[]> {
  await ensureSchema();
  const rows = await getSql()`
    SELECT escalation_id FROM escalations
    WHERE session_id = ${sessionId} AND status = 'pending'
    ORDER BY created_at ASC
  `;
  return (rows as { escalation_id: string }[]).map((r) =>
    String(r.escalation_id)
  );
}

export async function sessionsForEscalationId(
  escalationId: string
): Promise<EscalationRecord[]> {
  await ensureSchema();
  const rows = await getSql()`
    SELECT * FROM escalations WHERE escalation_id = ${escalationId}
  `;
  return (rows as Record<string, unknown>[]).map(rowToRecord);
}

export async function markAnswered(
  escalationId: string,
  answer: string
): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await getSql()`
    UPDATE escalations SET
      status = CASE WHEN status = 'delivered' THEN 'delivered' ELSE 'answered' END,
      answer = ${answer},
      updated_at = ${now}
    WHERE escalation_id = ${escalationId}
      AND status IN ('pending', 'answered')
  `;
}

export async function markDismissed(escalationId: string): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await getSql()`
    UPDATE escalations SET
      status = CASE WHEN status = 'delivered' THEN 'delivered' ELSE 'dismissed' END,
      updated_at = ${now}
    WHERE escalation_id = ${escalationId}
      AND status IN ('pending', 'answered', 'dismissed')
  `;
}

export async function markDelivered(
  escalationId: string,
  sessionId: string
): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await getSql()`
    UPDATE escalations SET
      status = 'delivered',
      delivered_at = ${now},
      updated_at = ${now}
    WHERE escalation_id = ${escalationId} AND session_id = ${sessionId}
  `;
}

export async function markFailed(
  escalationId: string,
  sessionId: string
): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await getSql()`
    UPDATE escalations SET
      status = 'failed',
      updated_at = ${now}
    WHERE escalation_id = ${escalationId} AND session_id = ${sessionId}
  `;
}
