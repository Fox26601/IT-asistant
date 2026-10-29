#!/usr/bin/env node
/**
 * Fills [ІМʼЯ] / [EMAIL] / [GITHUB] / [DEMO1] / [DEMO2] from .env.
 * Dry-run by default. Real send only when ALL are true:
 *   - CLI flag --send
 *   - SMTP_* env vars set
 *   - CSV row has send=yes AND status=ready AND non-empty contact_email
 *
 * Usage:
 *   node scripts/send_outreach.mjs              # preview ready rows (env-filled)
 *   node scripts/send_outreach.mjs --preview-all # all rows with subject/body
 *   node scripts/send_outreach.mjs --send
 *   node scripts/send_outreach.mjs --send --limit 5
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createTransport } from "nodemailer";

const args = new Set(process.argv.slice(2));
const wantSend = args.has("--send");
const previewAll = args.has("--preview-all");
const limitArg = process.argv.find((a, i, arr) => arr[i - 1] === "--limit");
const limit = limitArg ? Number(limitArg) : Infinity;

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/** Minimal RFC4180-ish CSV parser (supports quotes and newlines in fields). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\n" || (c === "\r" && text[i + 1] === "\n")) {
      if (c === "\r") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((cell) => String(cell).trim() !== ""))
    .map((r) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = (r[idx] ?? "").trim();
      });
      return obj;
    });
}

function profileFromEnv() {
  const name = process.env.OUTREACH_NAME || process.env.FROM_NAME || "";
  const email =
    process.env.OUTREACH_EMAIL ||
    process.env.FROM_EMAIL ||
    process.env.SMTP_USER ||
    "";
  return {
    name,
    email,
    github: process.env.OUTREACH_GITHUB || "",
    demo1: process.env.OUTREACH_DEMO1 || "",
    demo2: process.env.OUTREACH_DEMO2 || "",
  };
}

function applyPlaceholders(text, profile) {
  if (!text) return text;
  return text
    .replaceAll("[ІМʼЯ]", profile.name)
    .replaceAll("[ІМ'Я]", profile.name) // ASCII apostrophe variant
    .replaceAll("[EMAIL]", profile.email)
    .replaceAll("[GITHUB]", profile.github)
    .replaceAll("[DEMO1]", profile.demo1)
    .replaceAll("[DEMO2]", profile.demo2);
}

function unresolvedPlaceholders(text) {
  return [...new Set([...String(text).matchAll(/\[[^\]]+\]/g)].map((m) => m[0]))];
}

function looksLikePlaceholder(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return true;
  return (
    v.includes("your_") ||
    v.includes("example") ||
    v.includes("yourname") ||
    v.includes("your_github") ||
    v === "you@gmail.com"
  );
}

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      !looksLikePlaceholder(process.env.SMTP_USER) &&
      !looksLikePlaceholder(process.env.SMTP_PASS) &&
      (process.env.FROM_EMAIL || process.env.SMTP_USER)
  );
}

function profileReady(profile) {
  return Boolean(
    profile.name &&
      profile.email &&
      !looksLikePlaceholder(profile.email) &&
      profile.github &&
      !looksLikePlaceholder(profile.github) &&
      profile.demo1 &&
      !looksLikePlaceholder(profile.demo1) &&
      profile.demo2 &&
      !looksLikePlaceholder(profile.demo2)
  );
}

async function main() {
  loadDotEnv();
  const profile = profileFromEnv();
  const csvPath = resolve(
    process.cwd(),
    process.env.OUTREACH_CSV || "outreach/employers.csv"
  );
  if (!existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const records = parseCsv(readFileSync(csvPath, "utf8")).map((r) => ({
    ...r,
    subject_ua: applyPlaceholders(r.subject_ua, profile),
    body_ua: applyPlaceholders(r.body_ua, profile),
  }));

  const withCopy = records.filter((r) => r.subject_ua && r.body_ua);
  const ready = withCopy.filter((r) => r.status === "ready");
  const candidates = ready.filter(
    (r) => r.send === "yes" && r.contact_email
  );

  console.log(`CSV: ${csvPath}`);
  console.log(`Total rows: ${records.length}`);
  console.log(`Rows with letter draft: ${withCopy.length}`);
  console.log(`status=ready: ${ready.length}`);
  console.log(`Eligible to send (send=yes + email): ${candidates.length}`);
  console.log(`Mode: ${wantSend ? "SEND" : "DRY-RUN"}`);
  console.log(`SMTP configured: ${smtpConfigured() ? "yes" : "no"}`);
  const flag = (value) =>
    !value ? "MISSING" : looksLikePlaceholder(value) ? "PLACEHOLDER" : "ok";
  console.log(
    `Profile from .env: name=${flag(profile.name)} email=${flag(
      profile.email
    )} github=${flag(profile.github)} demo1=${flag(profile.demo1)} demo2=${flag(
      profile.demo2
    )}`
  );

  if (!existsSync(resolve(process.cwd(), ".env"))) {
    console.log(
      "\nNo .env yet. Copy .env.example → .env and fill OUTREACH_* (and SMTP_* for send)."
    );
  }

  const toShow = previewAll
    ? withCopy
    : wantSend
      ? candidates
      : ready.length
        ? ready
        : withCopy;
  const batch = toShow.slice(0, Number.isFinite(limit) ? limit : toShow.length);

  if (!batch.length) {
    console.log("\nNothing to preview.");
    return;
  }

  for (const [idx, r] of batch.entries()) {
    const left = [
      ...unresolvedPlaceholders(r.subject_ua),
      ...unresolvedPlaceholders(r.body_ua),
    ];
    console.log(`\n--- ${idx + 1}/${batch.length} ${r.org} [${r.status}] channel=${r.channel}`);
    console.log(`To: ${r.contact_email || "(form/dou — send manually)"}`);
    console.log(`Subject: ${r.subject_ua}`);
    console.log(`Body:\n${r.body_ua}`);
    if (left.length) {
      console.log(`Unresolved placeholders: ${[...new Set(left)].join(", ")}`);
    }
  }

  if (!wantSend) {
    console.log(
      "\nDry-run only. Fill .env once (OUTREACH_*), set send=yes on approved email rows, then: npm run outreach:send"
    );
    return;
  }

  if (!profileReady(profile)) {
    console.error(
      "\n--send refused: fill OUTREACH_NAME, OUTREACH_EMAIL, OUTREACH_GITHUB, OUTREACH_DEMO1, OUTREACH_DEMO2 in .env"
    );
    process.exit(1);
  }

  if (!smtpConfigured()) {
    console.error(
      "\n--send refused: SMTP env incomplete. Set SMTP_HOST, SMTP_USER, SMTP_PASS, FROM_EMAIL in .env"
    );
    process.exit(1);
  }

  if (!candidates.length) {
    console.error(
      "\n--send refused: no rows with send=yes, status=ready, and contact_email"
    );
    process.exit(1);
  }

  const sendBatch = candidates.slice(
    0,
    Number.isFinite(limit) ? limit : candidates.length
  );
  const blocked = sendBatch.filter(
    (r) =>
      unresolvedPlaceholders(r.subject_ua).length ||
      unresolvedPlaceholders(r.body_ua).length
  );
  if (blocked.length) {
    console.error(
      `\nRefusing to send: ${blocked.length} row(s) still have [PLACEHOLDERS] after env fill.`
    );
    process.exit(1);
  }

  const transporter = createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || "false") === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const from = process.env.FROM_NAME || profile.name
    ? `"${process.env.FROM_NAME || profile.name}" <${
        process.env.FROM_EMAIL || process.env.SMTP_USER || profile.email
      }>`
    : process.env.FROM_EMAIL || process.env.SMTP_USER;

  for (const r of sendBatch) {
    const info = await transporter.sendMail({
      from,
      to: r.contact_email,
      subject: r.subject_ua,
      text: r.body_ua,
      replyTo: profile.email || undefined,
    });
    console.log(`Sent to ${r.contact_email}: ${info.messageId || "ok"}`);
    await new Promise((res) => setTimeout(res, 1500));
  }

  console.log(
    "\nDone. Manually set status=sent for those rows in employers.csv after you confirm delivery."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
