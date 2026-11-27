# IT-asistant

Sales booking agent for [symbolicpleasures.com](https://symbolicpleasures.com): Telegram + website leads → LLM dialogue → Google Calendar + owner Telegram notify.

Repo: https://github.com/Fox26601/IT-asistant (public)

| Path | What it is |
|---|---|
| [`sales-agent/`](sales-agent/) | Deploy root (Vercel). Product domains: `sales-manager/`, `messaging/`, `mail/`, plus `api/`, `config/`, `shared/`, `bot/` |

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
- Site: `POST /webhooks/site-lead` with header `x-webhook-secret` (query `?secret=` rejected).
- Deal → Calendar (or mock) + Telegram alert to the owner.
- **Vercel:** root `sales-agent` — [deploy guide](sales-agent/README.md#deploy-on-vercel-primary). HTTPS `PUBLIC_BASE_URL` + Telegram **webhook**.
- Layout: [sales-agent/docs/STRUCTURE.md](sales-agent/docs/STRUCTURE.md).

Full runbook: [`sales-agent/README.md`](sales-agent/README.md).
