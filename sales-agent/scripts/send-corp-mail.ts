/**
 * Send one corp email via Resend (preferred) or SMTP_* fallback.
 *
 * Usage:
 *   npx tsx scripts/send-corp-mail.ts --to ADDR --subject "..." --body-file path.md
 *   npx tsx scripts/send-corp-mail.ts --to ADDR --subject "..." --body-file path.md --dry-run
 *
 * Or pipe text on stdin when --body-file is omitted.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../src/config.js";
import {
  sendCorpMail,
  mailConfigured,
  mailStatus,
} from "../src/integrations/corpMail.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const to = (argValue("--to") || "").trim();
  const subject = (argValue("--subject") || "").trim();
  const bodyFile = argValue("--body-file");
  const replyTo = argValue("--reply-to")?.trim();
  const dryRun = hasFlag("--dry-run");

  if (!to || !subject) {
    console.error(
      "Usage: tsx scripts/send-corp-mail.ts --to ADDR --subject TEXT [--body-file PATH] [--reply-to ADDR] [--dry-run]"
    );
    process.exit(2);
  }

  let text = "";
  if (bodyFile) {
    text = readFileSync(resolve(process.cwd(), bodyFile), "utf8");
  } else if (!process.stdin.isTTY) {
    text = await readStdin();
  }
  text = text.trim();
  if (!text) {
    console.error("Body empty: pass --body-file or pipe stdin");
    process.exit(2);
  }

  console.log("[corp-mail] status:", JSON.stringify(mailStatus()));
  console.log(`[corp-mail] from=${config.mailFrom} to=${to}`);
  console.log(`[corp-mail] subject=${subject}`);

  if (dryRun) {
    console.log("[corp-mail] dry-run — not sending. Body preview:\n");
    console.log(text.slice(0, 2000));
    process.exit(0);
  }

  if (!mailConfigured()) {
    console.error(
      "[corp-mail] not configured. Set RESEND_API_KEY + MAIL_FROM (preferred) or SMTP_* fallback."
    );
    process.exit(1);
  }

  const result = await sendCorpMail({ to, subject, text, replyTo });
  console.log(
    `[corp-mail] ok provider=${result.provider} messageId=${result.messageId}`
  );
}

main().catch((err) => {
  console.error("[corp-mail] failed", err);
  process.exit(1);
});
