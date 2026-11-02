import { Hono } from "hono";
import { config } from "../config.js";
import {
  createSession,
  getSessionById,
  saveSession,
} from "../db/sessions.js";
import { handleUserTurn } from "../agent/dialogue.js";
import { notifyOwnerLead } from "../integrations/ownerNotify.js";

type LeadBody = {
  name?: string;
  contact?: string;
  message?: string;
  email?: string;
  phone?: string;
};

function handoffUrl(sessionId: string): string | undefined {
  if (!config.botUsername) return undefined;
  return `https://t.me/${config.botUsername}?start=web_${sessionId}`;
}

export function createWebApp() {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      hasGemini: Boolean(config.geminiApiKey),
      hasTelegram: Boolean(config.telegramToken),
      hasOwnerChat: Boolean(config.ownerChatId),
      botUsername: config.botUsername || null,
      publicBaseUrl: config.publicBaseUrl,
      mockCalendar: config.allowMock,
    })
  );

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
      const session = createSession("web", externalUserId, {
        clientName: body.name,
        contact,
        notes: body.message,
      });

      const seed = [
        "New website lead started a booking conversation.",
        body.name ? `Name: ${body.name}` : "",
        `Contact: ${contact}`,
        body.message ? `Initial message: ${body.message}` : "",
        "Acknowledge the lead, ask the next qualifying question, and invite them to continue in Telegram if a bot username is configured.",
      ]
        .filter(Boolean)
        .join("\n");

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
    const body = (await c.req.json()) as { sessionId?: string; message?: string };
    if (!body.sessionId || !body.message?.trim()) {
      return c.json({ error: "sessionId and message required" }, 400);
    }
    const session = getSessionById(body.sessionId);
    if (!session) return c.json({ error: "session not found" }, 404);
    const turn = await handleUserTurn(session, body.message.trim());
    return c.json({
      ok: true,
      reply: turn.reply,
      status: turn.session.status,
      booked: turn.booked,
    });
  });

  return app;
}
