#!/usr/bin/env bash
# Authenticated smoke against Symbolic Pleasures site API.
# Usage: from sales-agent/ with SITE_WEBHOOK_SECRET set, or copy .env.example → .env
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

BASE="${SITE_BASE_URL:-https://symbolicpleasures.com}"
SECRET="${SITE_WEBHOOK_SECRET:-${WEBHOOK_SECRET:-}}"

if [[ -z "$SECRET" ]]; then
  echo "Missing SITE_WEBHOOK_SECRET (or WEBHOOK_SECRET). Set in env or sales-agent/.env" >&2
  exit 1
fi

echo "== GET policy =="
curl -sS "$BASE/api/sales-agent/policy" \
  -H "x-webhook-secret: $SECRET" | tee /tmp/sp-policy.json
echo

echo "== POST escalations =="
curl -sS -X POST "$BASE/api/sales-agent/escalations" \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: $SECRET" \
  -d '{
    "question":"it-asistant smoke: confirm escalate API",
    "topic":"smoke",
    "proposed_answer":"refuse until confirmed",
    "context_excerpt":"ops smoke",
    "session_id":"it-asistant-smoke-1",
    "practice_ids":[]
  }' | tee /tmp/sp-escalate.json
echo

ID="$(python3 -c 'import json;d=json.load(open("/tmp/sp-escalate.json")); print(d.get("escalation_id") or d.get("id") or "")' 2>/dev/null || true)"
if [[ -z "$ID" ]]; then
  echo "No escalation_id in response — check HTTP body above" >&2
  exit 2
fi
echo "escalation_id=$ID"

echo "== GET escalations?ids= =="
curl -sS "$BASE/api/sales-agent/escalations?ids=$ID" \
  -H "x-webhook-secret: $SECRET" | tee /tmp/sp-escalate-get.json
echo
echo "OK smoke finished"
