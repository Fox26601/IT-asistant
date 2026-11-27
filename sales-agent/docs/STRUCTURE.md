# sales-agent layout (product domains)

Vercel **Root Directory** stays `sales-agent` (do not rename). HTTP routes are unchanged.

| Folder | Domain |
|--------|--------|
| `api/` | Vercel serverless entry (`api/index.ts`) — keep this path |
| `sales-manager/` | Booking dialogue, sessions, escalations, site API, calendar |
| `messaging/` | Telegram bot, owner notify, ops-alert path into owner chat |
| `mail/` | Corp outbound mail (Resend / SMTP) — no `SMTP_FROM_NAME` |
| `config/` | Env loading + `PUBLIC_BASE_URL` / webhook helpers |
| `shared/` | Postgres, Gemini, media, HTTP app, security helpers |
| `bot/` | Node/Docker long-poll entry + Google OAuth helper |
| `docs/` | In-repo structure notes |
| `scripts/` | Smoke / one-off CLI |

Future broadcast/fan-out work belongs under `messaging/` (e.g. `messaging/broadcast/`) — not mixed into `sales-manager/`.
