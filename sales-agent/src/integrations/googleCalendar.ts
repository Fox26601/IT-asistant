import { google } from "googleapis";
import { config } from "../config.js";
import type { DealSlots } from "../db/sessions.js";

export type CreatedEvent = {
  id: string;
  htmlLink?: string;
  mock?: boolean;
};

function oauthClient() {
  const client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );
  client.setCredentials({ refresh_token: config.googleRefreshToken });
  return client;
}

function parsePreferredStart(preferredDateTime?: string): {
  start: Date;
  end: Date;
} {
  const now = new Date();
  let start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (preferredDateTime) {
    const parsed = Date.parse(preferredDateTime);
    if (!Number.isNaN(parsed)) {
      start = new Date(parsed);
    } else {
      // Keep a hold tomorrow; put free-text in description
      start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      start.setMinutes(0, 0, 0);
    }
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

export function calendarConfigured(): boolean {
  return Boolean(
    config.googleClientId &&
      config.googleClientSecret &&
      config.googleRefreshToken
  );
}

export async function createDealEvent(input: {
  sessionId: string;
  channel: string;
  externalUserId: string;
  slots: DealSlots;
}): Promise<CreatedEvent> {
  const { start, end } = parsePreferredStart(input.slots.preferredDateTime);
  const summary = `SP booking request — ${
    input.slots.clientName || input.slots.contact || input.externalUserId
  }`;
  const description = [
    `Session: ${input.sessionId}`,
    `Channel: ${input.channel}`,
    `User: ${input.externalUserId}`,
    `Need: ${input.slots.need || "—"}`,
    `Format: ${input.slots.format || "—"}`,
    `Budget/package: ${input.slots.budgetOrPackage || "—"}`,
    `Preferred: ${input.slots.preferredDateTime || "—"}`,
    `Contact: ${input.slots.contact || "—"}`,
    `Notes: ${input.slots.notes || "—"}`,
    `Consent: ${input.slots.consentToBook ? "yes" : "no"}`,
  ].join("\n");

  if (!calendarConfigured()) {
    if (!config.allowMock) {
      throw new Error(
        "Google Calendar not configured. Set GOOGLE_* env or ALLOW_MOCK_INTEGRATIONS=true"
      );
    }
    const mockId = `mock-${input.sessionId}`;
    console.warn(`[calendar] MOCK event ${mockId}: ${summary}`);
    return { id: mockId, mock: true };
  }

  const auth = oauthClient();
  const calendar = google.calendar({ version: "v3", auth });
  const res = await calendar.events.insert({
    calendarId: config.googleCalendarId,
    requestBody: {
      summary,
      description,
      start: { dateTime: start.toISOString(), timeZone: config.tz },
      end: { dateTime: end.toISOString(), timeZone: config.tz },
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 60 },
          { method: "popup", minutes: 1440 },
        ],
      },
    },
  });

  return {
    id: res.data.id || `unknown-${input.sessionId}`,
    htmlLink: res.data.htmlLink || undefined,
  };
}
