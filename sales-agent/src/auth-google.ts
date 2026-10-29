/**
 * One-time OAuth helper: prints an auth URL, then exchange code → refresh token.
 *
 * Usage:
 *   1) Fill GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env
 *   2) npm run auth:google
 *   3) Open the printed URL, approve Calendar access
 *   4) Paste the `code` query param from the redirect URL
 *   5) Copy GOOGLE_REFRESH_TOKEN into .env
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { google } from "googleapis";
import { config } from "./config.js";

async function main() {
  if (!config.googleClientId || !config.googleClientSecret) {
    console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.");
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
  });

  console.log("\n1) Open this URL in a browser:\n");
  console.log(url);
  console.log(
    `\n2) After approve, you land on ${config.googleRedirectUri}?code=...`
  );
  console.log("   Copy the `code` value (URL-decoded).\n");

  const rl = createInterface({ input, output });
  const code = (await rl.question("Paste code: ")).trim();
  rl.close();

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "No refresh_token returned. Revoke app access in Google Account and retry with prompt=consent."
    );
    process.exit(1);
  }

  console.log("\nAdd to sales-agent/.env:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
