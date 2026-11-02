# IT-asistant

Sales booking agent for [symbolicpleasures.com](https://symbolicpleasures.com): Telegram + website leads → LLM dialogue → Google Calendar + owner Telegram notify.

Repo: https://cursor.com/codebase/daniil-bxvm8/IT-asistant

| Path | What it is |
|---|---|
| [`sales-agent/`](sales-agent/) | Bot + HTTP webhooks, SQLite sessions, Render deploy (`Dockerfile`, `render.yaml`) |

UA GovTech job outreach (CSV, letters, SMTP) moved to a separate repo:  
**[daniil-bxvm8/ua-govtech-outreach](https://cursor.com/codebase/daniil-bxvm8/ua-govtech-outreach)**

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
- **Render:** second Web Service next to the site — [deploy guide](sales-agent/README.md#deploy-on-render-same-workspace-as-the-site). HTTPS `PUBLIC_BASE_URL` enables Telegram webhook; localhost keeps long polling.

Full runbook: [`sales-agent/README.md`](sales-agent/README.md).
