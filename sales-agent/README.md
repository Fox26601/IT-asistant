# Sales dialogue agent (Telegram + web → Calendar)

Booking assistant for **symbolicpleasures.com**: qualifies clients in Telegram (text / photo / voice), accepts website leads, reads live catalog/availability/policy from the site API, writes a Google Calendar hold, and pings you in Telegram.

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
3. Message bot in **private** chat: `/owner` → bot replies with your user `chat_id`. Put that value in Vercel `OWNER_TELEGRAM_CHAT_ID` (must **not** be the bot’s own id — that causes 403 “bot can't send messages to the bot”). `/start` alone is for buyers.
4. Set `TELEGRAM_WEBHOOK_SECRET` to a long random string (used in webhook path)

### 2) Gemini

`GEMINI_API_KEY` from [Google AI Studio](https://aistudio.google.com/apikey).  
Optional: `GEMINI_MODEL` (default `gemini-3.8-flash`).

### 3) Site API

Read-only tools call `SITE_BASE_URL/api/sales-agent/*` with header `x-webhook-secret: SITE_WEBHOOK_SECRET`.

| Key | Notes |
|---|---|
| `SITE_BASE_URL` | default `https://symbolicpleasures.com` (no trailing slash) |
| `SITE_WEBHOOK_SECRET` | same as site `SALES_AGENT_WEBHOOK_SECRET`; if empty, falls back to `WEBHOOK_SECRET` |

Agent starts without a site secret (mock/dev), but site tools return `site_not_configured` until set.

`fetch_catalog` and `fetch_policy` use an in-process **TTL cache (~5 min)**. Availability and status endpoints are always fresh. Policy `hard_limits` / `limits_text` are stripped before the model sees them.

If catalog/policy do not answer a question, the agent calls **`escalate_to_operator`** → site admin AI tab (`https://symbolicpleasures.com/admin?tab=ai`). Escalation follow-ups: on Node/Docker a background poller (~every 3 min); on **Vercel** a Cron job hits `GET /cron/escalations` every 3 minutes. **answered** → paraphrase follow-up to the buyer in Telegram; **dismissed** → short “not confirmed” + `/book` or `/contact`, then clear pending. Web sessions store the reply on the session and notify the owner.

If `/api/sales-agent/escalations` is still **404**, tools return `not_available` and the agent falls back to `/contact` or `/book` | `/customs` | `/browse` (no follow-up promise).

Smoke:

```bash
curl -sS "$SITE_BASE_URL/api/sales-agent/catalog" -H "x-webhook-secret: $SITE_WEBHOOK_SECRET"
curl -sS "$SITE_BASE_URL/api/sales-agent/policy" -H "x-webhook-secret: $SITE_WEBHOOK_SECRET"
# without header → 401
curl -sS -o /dev/null -w "%{http_code}\n" "$SITE_BASE_URL/api/sales-agent/catalog"
# escalations (200 when site Part B is live; 404 until then)
curl -sS -w "\n%{http_code}\n" -X POST "$SITE_BASE_URL/api/sales-agent/escalations" \
  -H "x-webhook-secret: $SITE_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"question":"smoke","topic":"smoke","session_id":"smoke"}'
```

### 4) Google Calendar (optional)

`ALLOW_MOCK_INTEGRATIONS=true` until OAuth is done. Then `npm run auth:google`.

### 5) Run locally

```bash
npm run start
```

- `PUBLIC_BASE_URL=http://localhost:3847` → **long polling** (Node only)
- HTTPS public URL / **Vercel** → **Telegram webhook** (long-poll cannot run on serverless)

## Deploy on Vercel (primary)

Repo: GitHub `Fox26601/IT-asistant`. Root directory: **`sales-agent`** ([`vercel.json`](vercel.json) + [`api/index.ts`](api/index.ts)).

1. Vercel → **Add New Project** → import `Fox26601/IT-asistant`
2. **Root Directory:** `sales-agent` · Node **22.x** · Framework: Other
3. After first deploy, copy the URL, e.g. `https://it-asistant.vercel.app`
4. Project → **Settings → Environment Variables** (Production + Preview):

| Key | Notes |
|---|---|
| `TELEGRAM_BOT_TOKEN` | from BotFather |
| `OWNER_TELEGRAM_CHAT_ID` | your user chat id from `/owner` (not the bot id) |
| `TELEGRAM_BOT_USERNAME` | without `@` |
| `TELEGRAM_WEBHOOK_SECRET` | long random string |
| `GEMINI_API_KEY` | AI Studio |
| `GEMINI_MODEL` | e.g. `gemini-2.5-flash` |
| `WEBHOOK_SECRET` | same as site `SALES_AGENT_WEBHOOK_SECRET` |
| `SITE_BASE_URL` | `https://symbolicpleasures.com` |
| `SITE_WEBHOOK_SECRET` | same as `WEBHOOK_SECRET` if shared |
| `PUBLIC_BASE_URL` | `https://<project>.vercel.app` (no trailing slash) |
| `ALLOW_MOCK_INTEGRATIONS` | `true` until Calendar OAuth |
| `RESEND_API_KEY` | from [resend.com](https://resend.com) (preferred mail) |
| `MAIL_FROM` | bare `kiniks@symbolicpleasures.com` (or Resend onboarding from) |
| `CRON_SECRET` | random; Cron sends `Authorization: Bearer …` |
| `SMTP_*` | optional fallback only — often blocked on serverless |

Do **not** set `SMTP_FROM_NAME`.

5. Redeploy → `GET https://…/health` → `ok: true`, `runtime: "vercel"`
6. Register Telegram webhook once:

```bash
curl -sS -X POST "$PUBLIC_BASE_URL/webhooks/setup-telegram" \
  -H "x-webhook-secret: $WEBHOOK_SECRET"
```

7. DM `@Symbolic_Bot` → `/owner` → put `chat_id` into `OWNER_TELEGRAM_CHAT_ID` if still wrong.

**Notes:** SQLite under `/tmp` is ephemeral across isolates; deals still notify Telegram + Calendar. Escalations use Vercel Cron (`*/3 * * * *` → `/cron/escalations`). `maxDuration` = 60s.

### Wire the website (HornyFans)

| Key | Value |
|---|---|
| `SALES_AGENT_URL` | same as agent `PUBLIC_BASE_URL` (Vercel HTTPS) |
| `SALES_AGENT_WEBHOOK_SECRET` | same as agent `WEBHOOK_SECRET` |

Redeploy the site. Form proxy: `POST {SALES_AGENT_URL}/webhooks/site-lead` + `x-webhook-secret`.

### Legacy: Render (optional)

[`Dockerfile`](Dockerfile) / [`render.yaml`](render.yaml) still work for a long-running Node process (long-poll or webhook). Prefer Vercel — do not pay Render Starter just for SMTP; use Resend instead.

## Ops alerts (site → Telegram owner)

The website posts structured ops alerts here; the agent forwards them to `OWNER_TELEGRAM_CHAT_ID` (same bot as booking leads). Auth: `x-webhook-secret` = `WEBHOOK_SECRET`.

```bash
curl -X POST "$PUBLIC_BASE_URL/webhooks/ops-alert" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: YOUR_WEBHOOK_SECRET" \
  -d '{
    "severity": "P1",
    "code": "userpath.pay.fulfill_fail",
    "fingerprint": "fulfill_fail:nowpayments",
    "count": 1,
    "text": "Оплата: fulfill не прошёл (nowpayments).",
    "meta": { "request_id": "abc", "path": "/webhooks/nowpayments" }
  }'
```

Response: `{ ok, deduped, fingerprint }`. Same fingerprint is silenced for ~15 minutes in-process. Site env: `SALES_AGENT_URL` + `SALES_AGENT_WEBHOOK_SECRET` (no Slack required).

## Website form (curl)

```bash
curl -X POST "$PUBLIC_BASE_URL/webhooks/site-lead" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: YOUR_WEBHOOK_SECRET" \
  -d '{
    "name":"Alex",
    "contact":"@alex",
    "message":"Looking for Saturday evening",
    "topic":"booking",
    "source":"site",
    "page":"/book",
    "buyer_gender":"man"
  }'
```

Response: `ok`, `sessionId`, `reply`, `continueInTelegram`, `suggestedPages` (`book` \| `customs` \| `browse`).

Optional booking status seed:

```json
{
  "booking": {
    "order_id": "ord_…",
    "meeting_type": "webcam",
    "service": "session",
    "slot": "2026-11-10T18:00:00+02:00",
    "price_usd": 120
  }
}
```

## Dialogue → deal

Gemini tools: `update_slots`, `create_deal` (calendar hold + owner notify — **not** payment), `handoff_human`, site read tools (`fetch_catalog`, `fetch_availability`, `fetch_policy`, `fetch_booking_status`, `fetch_customs_status`, `fetch_compatible_practices`), plus `escalate_to_operator` / `check_escalations`.

Checkout CTAs stay on the site: `/book`, `/customs`, `/browse` (plus `/contact` when escalations API is unavailable).

Collects: need, format, budget/package, preferred date-time, contact, consent → Calendar + owner Telegram.

Client commands: `/start`, `/status`.

## Corp outbound email (optional)

Ops / PayPal Support mail goes **from this service**, not from HornyFans app code.

**Prefer Resend HTTP** on Vercel (SMTP ports 25/465/587 are often blocked on serverless). SMTP_* remains a fallback for local / VPS.

| Key | Notes |
|---|---|
| `RESEND_API_KEY` | [resend.com](https://resend.com) API key (free tier OK) |
| `MAIL_FROM` | bare From address (falls back to `SMTP_FROM`) — **no** display-name |
| `SMTP_HOST` / `PORT` / `USER` / `PASSWORD` / `FROM` | optional fallback |
| `SMTP_TLS_MODE` | optional: `auto` \| `starttls` \| `ssl` \| `plain` |

Do **not** set `SMTP_FROM_NAME`. Verify the sending domain (or Resend onboarding domain) in the Resend dashboard before production mail.

```bash
npm run mail:send -- --to you@example.com \
  --subject "IT-asistant mail smoke" \
  --body-file scripts/paypal-support-draft.txt

curl -X POST "$PUBLIC_BASE_URL/webhooks/corp-mail" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -d '{"to":"…","subject":"…","text":"…","confirm":"SEND"}'
```

`GET /health` → `mail.configured` / `mail.provider` (`resend` \| `smtp`).
