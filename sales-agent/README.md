# Sales dialogue agent (Telegram + web → Calendar)

Booking assistant for **symbolicpleasures.com**: qualifies clients in Telegram (text / photo / voice), accepts website leads, writes a Google Calendar hold, and pings you in Telegram.

WhatsApp / Instagram are **not** included (Meta Business + adult-commerce policy limits).

## Setup (local)

```bash
cd sales-agent
cp .env.example .env
npm install
```

### 1) Telegram

1. [@BotFather](https://t.me/BotFather) → `/newbot` → `TELEGRAM_BOT_TOKEN`
2. `TELEGRAM_BOT_USERNAME` (without `@`)
3. Message bot `/start`, then `https://api.telegram.org/bot<TOKEN>/getUpdates` → your `chat.id` → `OWNER_TELEGRAM_CHAT_ID`
4. Set `TELEGRAM_WEBHOOK_SECRET` to a long random string (used on Render)

### 2) Gemini

`GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey).  
Optional: `GEMINI_MODEL` (default `gemini-3.8-flash`).

### 3) Google Calendar (optional)

`ALLOW_MOCK_INTEGRATIONS=true` until OAuth is done. Then `npm run auth:google`.

### 4) Run locally

```bash
npm run start
```

- `PUBLIC_BASE_URL=http://localhost:3847` → **long polling**
- HTTPS public URL → **Telegram webhook**

## Deploy on Render (same workspace as the site)

Repo: `daniil-bxvm8/IT-asistant`. Site stays as-is; agent is a **second Web Service**.

1. Render dashboard (account where symbolicpleasures.com lives) → **New → Web Service**
2. Connect repo `daniil-bxvm8/IT-asistant`
3. Settings:
   - **Root Directory:** `sales-agent`
   - **Runtime:** Docker (uses [`Dockerfile`](Dockerfile))  
     or Native: Build `npm install`, Start `npm run start`
4. After first deploy, copy the service URL, e.g. `https://sales-agent-xxxx.onrender.com`
5. Environment variables on **this** service:

| Key | Example |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from BotFather |
| `OWNER_TELEGRAM_CHAT_ID` | your chat id |
| `TELEGRAM_BOT_USERNAME` | bot name without `@` |
| `TELEGRAM_WEBHOOK_SECRET` | long random string |
| `GEMINI_API_KEY` | from AI Studio |
| `GEMINI_MODEL` | `gemini-3.8-flash` (optional) |
| `WEBHOOK_SECRET` | shared with the site |
| `PUBLIC_BASE_URL` | `https://sales-agent-xxxx.onrender.com` (no trailing slash) |
| `ALLOW_MOCK_INTEGRATIONS` | `true` until Google Calendar is wired |
| `PORT` | `3847` (Render may override with `$PORT` — app reads `PORT`) |

6. Redeploy → open `GET https://…/health` → should be `{ "ok": true }`
7. Message the bot `/start` (first request may cold-start ~1 min on Free)

Optional Blueprint: [`render.yaml`](render.yaml) → **New → Blueprint**.

### Wire the existing site service

On the **website** Render service env:

| Key | Value |
|---|---|
| `SALES_AGENT_URL` | same as agent `PUBLIC_BASE_URL` |
| `SALES_AGENT_WEBHOOK_SECRET` | same as agent `WEBHOOK_SECRET` |

Redeploy the site. Form proxy must `POST {SALES_AGENT_URL}/webhooks/site-lead` with header `x-webhook-secret`.

### Free plan notes

- Service **sleeps** after ~15 min idle; Telegram/site HTTPS traffic wakes it (cold start).
- SQLite under `data/` is **ephemeral** on Free — sessions may reset on redeploy; deals still go to Calendar + your Telegram notify.

## Website form (curl)

```bash
curl -X POST "$PUBLIC_BASE_URL/webhooks/site-lead" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: YOUR_WEBHOOK_SECRET" \
  -d '{"name":"Alex","contact":"@alex","message":"Looking for Saturday evening"}'
```

Response: `ok`, `sessionId`, `reply`, `continueInTelegram`.

## Dialogue → deal

Collects: need, format, budget/package, preferred date-time, contact, consent → Calendar + owner Telegram.

Client commands: `/start`, `/status`.
