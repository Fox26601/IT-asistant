# Workspace: outreach pack + sales dialogue agent

Two pieces in this repo:

1. **[`outreach/`](outreach/)** — job outreach for UA digital-state / GovTech (CSV + letter templates + SMTP dry-run).
2. **[`sales-agent/`](sales-agent/)** — booking agent for symbolicpleasures.com (Telegram + web form → Google Calendar + owner Telegram notify).

---

## Sales agent (Telegram + web → Calendar)

See full runbook: [`sales-agent/README.md`](sales-agent/README.md)

```bash
cd sales-agent
cp .env.example .env   # TELEGRAM_BOT_TOKEN, OPENAI_API_KEY, OWNER_TELEGRAM_CHAT_ID, …
npm install
npm run start          # local: long-poll + HTTP :3847
```

- Clients chat in Telegram (text / photo / voice).
- Site leads: `POST /webhooks/site-lead` with `x-webhook-secret`.
- Deal → Google Calendar (or mock) + Telegram alert to you.
- **Render:** second Web Service next to the site — see [Deploy section](sales-agent/README.md#deploy-on-render-same-workspace-as-the-site) (`Dockerfile`, `render.yaml`, webhook mode when `PUBLIC_BASE_URL` is HTTPS).

---

## Outreach pack (UA digital-state)

Плейсхолдери в CSV **не правите руками**. Один раз `.env` у корені репо:

```bash
cp .env.example .env
npm install
npm run outreach:dry-run
```

| Змінна | Що це |
|---|---|
| `OUTREACH_NAME` | імʼя → `[ІМʼЯ]` |
| `OUTREACH_EMAIL` | ваш email → `[EMAIL]` |
| `OUTREACH_GITHUB` | GitHub → `[GITHUB]` |
| `OUTREACH_DEMO1` / `OUTREACH_DEMO2` | демо → `[DEMO1]` / `[DEMO2]` |
| `SMTP_*` + `FROM_*` | лише для `npm run outreach:send` |

Деталі: [`outreach/sources.md`](outreach/sources.md), [`outreach/messages.md`](outreach/messages.md).
