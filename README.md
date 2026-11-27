# IT-asistant

Sales booking agent for [symbolicpleasures.com](https://symbolicpleasures.com): Telegram + website leads → LLM dialogue → Google Calendar + owner Telegram notify.

Repo: https://github.com/Fox26601/IT-asistant

| Path | What it is |
|---|---|
| [`sales-agent/`](sales-agent/) | Bot + HTTP webhooks, SQLite sessions, **Vercel** deploy (`vercel.json`, `api/`) |

UA GovTech job outreach (CSV, letters, SMTP) moved to a separate repo (`ua-govtech-outreach`).

---

## Quick start

```bash
cd sales-agent
cp .env.example .env   # TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, OWNER_TELEGRAM_CHAT_ID, …
npm install
npm run start          # local: long-poll + HTTP :3847
```

- Clients: text / photo / voice in Telegram.
- Site: `POST /webhooks/site-lead` with `x-webhook-secret`.
- Deal → Calendar (or mock) + Telegram alert to the owner.
- **Vercel:** root `sales-agent` — [deploy guide](sales-agent/README.md#deploy-on-vercel-primary). HTTPS `PUBLIC_BASE_URL` + Telegram **webhook** (no long-poll on serverless). Mail: **Resend** preferred (`RESEND_API_KEY`); SMTP fallback.

Full runbook: [`sales-agent/README.md`](sales-agent/README.md).
