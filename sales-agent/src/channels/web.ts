import { Hono } from "hono";
import { config } from "../config.js";
import {
  createSession,
  getSessionById,
  saveSession,
  type DealSlots,
} from "../db/sessions.js";
import { handleUserTurn } from "../agent/dialogue.js";
import {
  SUGGESTED_PAGE_PATHS,
  type SuggestedPage,
} from "../agent/prompts.js";
import { notifyOwnerLead } from "../integrations/ownerNotify.js";

type BookingInbound = {
  order_id?: string;
  meeting_type?: string;
  service?: string;
  slot?: string;
  price_usd?: number | string;
  notes?: string;
};

type LeadBody = {
  name?: string;
  contact?: string;
  message?: string;
  email?: string;
  phone?: string;
  topic?: string;
  source?: string;
  page?: string;
  buyer_gender?: string;
  buyer_gender_custom?: string;
  booking?: BookingInbound;
};

function handoffUrl(sessionId: string): string | undefined {
  if (!config.botUsername) return undefined;
  return `https://t.me/${config.botUsername}?start=web_${sessionId}`;
}

function normalizeSuggestedPage(raw: string | undefined): SuggestedPage | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\//, "")
    .split(/[?#]/)[0]
    ?.split("/")[0];
  if (!cleaned) return null;
  return (SUGGESTED_PAGE_PATHS as readonly string[]).includes(cleaned)
    ? (cleaned as SuggestedPage)
    : null;
}

/** Derive CTA pages for the site widget from topic/page heuristics. */
export function deriveSuggestedPages(input: {
  topic?: string;
  page?: string;
  hasBooking?: boolean;
  message?: string;
}): SuggestedPage[] {
  const out = new Set<SuggestedPage>();
  const fromPage = normalizeSuggestedPage(input.page);
  if (fromPage) out.add(fromPage);

  const blob = `${input.topic || ""} ${input.message || ""}`.toLowerCase();
  if (/\bcustom/.test(blob)) out.add("customs");
  if (/\b(book|booking|session|webcam|meet)/.test(blob)) out.add("book");
  if (/\b(browse|catalog|creator|practice)/.test(blob)) out.add("browse");
  if (input.hasBooking) out.add("book");

  if (out.size === 0) {
    out.add("book");
    out.add("browse");
  }
  return [...out];
}

function seedLeadSlots(body: LeadBody, contact: string): DealSlots {
  const booking = body.booking || {};
  const bookingNotes = [
    body.message,
    booking.notes ? `Booking notes: ${booking.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const slots: DealSlots = {
    clientName: body.name,
    contact,
    notes: bookingNotes || undefined,
    topic: body.topic,
    source: body.source,
    page: body.page,
    buyerGender: body.buyer_gender,
    buyerGenderCustom: body.buyer_gender_custom,
    orderId: booking.order_id,
    meetingType: booking.meeting_type,
    service: booking.service,
    slot: booking.slot,
    priceUsd: booking.price_usd,
  };

  if (booking.service && !slots.need) slots.need = booking.service;
  if (booking.meeting_type && !slots.format) slots.format = booking.meeting_type;
  if (booking.slot && !slots.preferredDateTime) {
    slots.preferredDateTime = booking.slot;
  }
  if (booking.price_usd != null && !slots.budgetOrPackage) {
    slots.budgetOrPackage = `$${booking.price_usd}`;
  }

  return slots;
}

export function createWebApp() {
  const app = new Hono();

  app.get("/health", async (c) => {
    let escalationsApi = false;
    try {
      const { escalationsAvailable } = await import(
        "../integrations/siteApi.js"
      );
      escalationsApi = await escalationsAvailable();
    } catch {
      escalationsApi = false;
    }
    return c.json({
      ok: true,
      hasGemini: Boolean(config.geminiApiKey),
      hasTelegram: Boolean(config.telegramToken),
      hasOwnerChat: Boolean(config.ownerChatId),
      botUsername: config.botUsername || null,
      publicBaseUrl: config.publicBaseUrl,
      siteBaseUrl: config.siteBaseUrl,
      hasSiteSecret: Boolean(config.siteWebhookSecret),
      escalationsApi,
      mockCalendar: config.allowMock,
    });
  });

  app.post("/webhooks/site-lead", async (c) => {
    const secret = c.req.header("x-webhook-secret") || c.req.query("secret");
    if (!secret || secret !== config.webhookSecret) {
      return c.json({ error: "unauthorized" }, 401);
    }

    let body: LeadBody = {};
    try {
      body = (await c.req.json()) as LeadBody;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    try {
      const contact =
        body.contact || body.email || body.phone || "web-unknown";
      const externalUserId = `web:${contact}:${Date.now()}`;
      const slots = seedLeadSlots(body, contact);
      const session = createSession("web", externalUserId, slots);

      const seedParts = [
        "New website lead started a booking conversation.",
        body.name ? `Name: ${body.name}` : "",
        `Contact: ${contact}`,
        body.topic ? `Topic: ${body.topic}` : "",
        body.source ? `Source: ${body.source}` : "",
        body.page ? `Page: ${body.page}` : "",
        body.buyer_gender ? `Buyer gender: ${body.buyer_gender}` : "",
        body.buyer_gender_custom
          ? `Buyer gender custom: ${body.buyer_gender_custom}`
          : "",
        body.message ? `Initial message: ${body.message}` : "",
        body.booking?.order_id
          ? `Existing booking order_id: ${body.booking.order_id} — call fetch_booking_status with this id.`
          : "",
        body.booking?.service
          ? `Booking service: ${body.booking.service}`
          : "",
        body.booking?.meeting_type
          ? `Meeting type: ${body.booking.meeting_type}`
          : "",
        body.booking?.slot ? `Slot: ${body.booking.slot}` : "",
        body.booking?.price_usd != null
          ? `Price USD: ${body.booking.price_usd}`
          : "",
        "Acknowledge the lead, ask the next qualifying question, and invite them to continue in Telegram if a bot username is configured.",
        "Use fetch_catalog before stating any prices. Checkout CTAs: /book, /customs, /browse.",
      ];

      const seed = seedParts.filter(Boolean).join("\n");

      let assistantReply = "";
      let dialogueError: string | undefined;
      try {
        const turn = await handleUserTurn(session, seed);
        assistantReply = turn.reply;
      } catch (err) {
        console.error("[web lead dialogue]", err);
        dialogueError = err instanceof Error ? err.message : String(err);
        assistantReply =
          "Thanks for reaching out — please continue the booking chat in Telegram.";
      }

      const url = handoffUrl(session.id);
      if (url) {
        session.slots.notes =
          `${session.slots.notes || ""}\nTelegram handoff: ${url}`.trim();
        saveSession(session);
      }

      const suggestedPages = deriveSuggestedPages({
        topic: body.topic,
        page: body.page,
        message: body.message,
        hasBooking: Boolean(body.booking?.order_id),
      });

      await notifyOwnerLead({
        sessionId: session.id,
        name: body.name,
        contact,
        message: body.message,
        handoffUrl: url,
      });

      return c.json({
        ok: true,
        sessionId: session.id,
        reply: assistantReply,
        continueInTelegram: url,
        suggestedPages,
        dialogueError,
      });
    } catch (err) {
      console.error("[web lead]", err);
      return c.json(
        {
          error: "internal",
          detail: err instanceof Error ? err.message : String(err),
        },
        500
      );
    }
  });

  /** Optional: continue a web session by id (for embedded chat later). */
  app.post("/webhooks/site-message", async (c) => {
    const secret = c.req.header("x-webhook-secret") || c.req.query("secret");
    if (!secret || secret !== config.webhookSecret) {
      return c.json({ error: "unauthorized" }, 401);
    }
    let body: { sessionId?: string; message?: string } = {};
    try {
      body = (await c.req.json()) as { sessionId?: string; message?: string };
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!body.sessionId || !body.message?.trim()) {
      return c.json({ error: "sessionId and message required" }, 400);
    }
    const session = getSessionById(body.sessionId);
    if (!session) return c.json({ error: "session not found" }, 404);
    try {
      const turn = await handleUserTurn(session, body.message.trim());
      return c.json({
        ok: true,
        reply: turn.reply,
        status: turn.session.status,
        booked: turn.booked,
        suggestedPages: deriveSuggestedPages({
          topic: session.slots.topic,
          page: session.slots.page,
          message: body.message,
          hasBooking: Boolean(session.slots.orderId),
        }),
      });
    } catch (err) {
      console.error("[web message]", err);
      return c.json(
        {
          ok: false,
          error: "dialogue_failed",
          detail: err instanceof Error ? err.message : String(err),
          status: session.status,
        },
        200
      );
    }
  });

  return app;
}
