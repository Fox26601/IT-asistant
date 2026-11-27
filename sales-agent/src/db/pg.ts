import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { config } from "../config.js";

let sql: NeonQueryFunction<false, false> | null = null;
let schemaReady: Promise<void> | null = null;

export function databaseUrl(): string {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    config.databaseUrl ||
    ""
  );
}

export function getSql(): NeonQueryFunction<false, false> {
  if (sql) return sql;
  const url = databaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL (or POSTGRES_URL) is required. Connect Vercel Postgres / Neon to this project."
    );
  }
  sql = neon(url);
  return sql;
}

export async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const q = getSql();
      await q`
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
        )
      `;
      await q`
        CREATE INDEX IF NOT EXISTS idx_sessions_channel_user
          ON sessions(channel, external_user_id)
      `;
      await q`
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
        )
      `;
      await q`
        CREATE INDEX IF NOT EXISTS idx_escalations_status
          ON escalations(status)
      `;
      await q`
        CREATE INDEX IF NOT EXISTS idx_escalations_session
          ON escalations(session_id)
      `;
      await q`
        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

export async function getMeta(key: string): Promise<string> {
  await ensureSchema();
  const rows = await getSql()`
    SELECT value FROM app_meta WHERE key = ${key} LIMIT 1
  `;
  const row = rows[0] as { value?: string } | undefined;
  return row?.value?.trim() || "";
}

export async function setMeta(key: string, value: string): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await getSql()`
    INSERT INTO app_meta (key, value, updated_at)
    VALUES (${key}, ${value}, ${now})
    ON CONFLICT (key) DO UPDATE SET
      value = EXCLUDED.value,
      updated_at = EXCLUDED.updated_at
  `;
}
