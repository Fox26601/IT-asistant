import { db } from "./sessions.js";

export type EscalationRecord = {
  escalationId: string;
  sessionId: string;
  question: string;
  status: "pending" | "answered" | "delivered" | "failed";
  answer?: string;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS escalations (
    escalation_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    question TEXT,
    status TEXT NOT NULL,
    answer TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    delivered_at TEXT,
    PRIMARY KEY (escalation_id, session_id)
  );
  CREATE INDEX IF NOT EXISTS idx_escalations_status
    ON escalations(status);
  CREATE INDEX IF NOT EXISTS idx_escalations_session
    ON escalations(session_id);
`);

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

export function trackEscalation(input: {
  escalationId: string;
  sessionId: string;
  question: string;
}): EscalationRecord {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO escalations
      (escalation_id, session_id, question, status, answer, created_at, updated_at, delivered_at)
     VALUES (?, ?, ?, 'pending', NULL, ?, ?, NULL)
     ON CONFLICT(escalation_id, session_id) DO UPDATE SET
       question = excluded.question,
       status = CASE
         WHEN escalations.status IN ('delivered', 'answered') THEN escalations.status
         ELSE 'pending'
       END,
       updated_at = excluded.updated_at`
  ).run(input.escalationId, input.sessionId, input.question, now, now);

  return (
    getEscalation(input.escalationId, input.sessionId) || {
      escalationId: input.escalationId,
      sessionId: input.sessionId,
      question: input.question,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    }
  );
}

export function getEscalation(
  escalationId: string,
  sessionId: string
): EscalationRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM escalations WHERE escalation_id = ? AND session_id = ?`
    )
    .get(escalationId, sessionId) as Record<string, unknown> | undefined;
  return row ? rowToRecord(row) : null;
}

export function listPendingEscalations(): EscalationRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM escalations
       WHERE status IN ('pending', 'answered')
       ORDER BY created_at ASC`
    )
    .all() as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

export function listPendingEscalationIds(): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT escalation_id FROM escalations
       WHERE status = 'pending'`
    )
    .all() as { escalation_id: string }[];
  return rows.map((r) => String(r.escalation_id));
}

export function sessionsForEscalationId(
  escalationId: string
): EscalationRecord[] {
  const rows = db
    .prepare(`SELECT * FROM escalations WHERE escalation_id = ?`)
    .all(escalationId) as Record<string, unknown>[];
  return rows.map(rowToRecord);
}

export function markAnswered(
  escalationId: string,
  answer: string
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE escalations SET
      status = CASE WHEN status = 'delivered' THEN 'delivered' ELSE 'answered' END,
      answer = ?,
      updated_at = ?
     WHERE escalation_id = ? AND status IN ('pending', 'answered')`
  ).run(answer, now, escalationId);
}

export function markDelivered(
  escalationId: string,
  sessionId: string
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE escalations SET
      status = 'delivered',
      delivered_at = ?,
      updated_at = ?
     WHERE escalation_id = ? AND session_id = ?`
  ).run(now, now, escalationId, sessionId);
}

export function markFailed(
  escalationId: string,
  sessionId: string
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE escalations SET
      status = 'failed',
      updated_at = ?
     WHERE escalation_id = ? AND session_id = ?`
  ).run(now, escalationId, sessionId);
}
