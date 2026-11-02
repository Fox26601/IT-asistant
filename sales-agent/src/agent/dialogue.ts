import {
  SchemaType,
  type Content,
  type FunctionDeclaration,
  type Part,
} from "@google/generative-ai";
import { config } from "../config.js";
import { getGemini } from "../llm/gemini.js";
import {
  saveSession,
  type DealSlots,
  type Session,
} from "../db/sessions.js";
import { SYSTEM_PROMPT, SLOT_CHECKLIST } from "./prompts.js";
import { createDealEvent } from "../integrations/googleCalendar.js";
import { notifyOwnerDeal } from "../integrations/ownerNotify.js";

const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "update_slots",
    description: "Merge newly learned booking fields into the deal profile",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        need: { type: SchemaType.STRING },
        format: { type: SchemaType.STRING },
        budgetOrPackage: { type: SchemaType.STRING },
        preferredDateTime: { type: SchemaType.STRING },
        contact: { type: SchemaType.STRING },
        consentToBook: { type: SchemaType.BOOLEAN },
        notes: { type: SchemaType.STRING },
        clientName: { type: SchemaType.STRING },
      },
    },
  },
  {
    name: "create_deal",
    description:
      "Register the booking: create Google Calendar event and notify the host. Call only when required slots are filled and consentToBook is true.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        confirm: {
          type: SchemaType.BOOLEAN,
          description: "Must be true to proceed",
        },
      },
      required: ["confirm"],
    },
  },
  {
    name: "handoff_human",
    description: "Flag that a human should take over",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        reason: { type: SchemaType.STRING },
      },
      required: ["reason"],
    },
  },
];

function missingSlots(slots: DealSlots): string[] {
  const missing: string[] = [];
  for (const key of SLOT_CHECKLIST) {
    if (key === "consentToBook") {
      if (slots.consentToBook !== true) missing.push(key);
    } else if (!slots[key] || String(slots[key]).trim() === "") {
      missing.push(key);
    }
  }
  return missing;
}

function mergeSlots(base: DealSlots, patch: Partial<DealSlots>): DealSlots {
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    (next as Record<string, unknown>)[k] = v;
  }
  return next;
}

function toGeminiHistory(session: Session): Content[] {
  const history: Content[] = [];
  for (const m of session.messages.slice(0, -1)) {
    if (m.role === "system") continue;
    history.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  // Gemini requires history to start with user if non-empty
  while (history.length && history[0].role !== "user") {
    history.shift();
  }
  return history;
}

export type TurnResult = {
  reply: string;
  session: Session;
  booked: boolean;
  handoff?: string;
};

export async function handleUserTurn(
  session: Session,
  userText: string
): Promise<TurnResult> {
  session.messages.push({
    role: "user",
    content: userText,
    at: new Date().toISOString(),
  });

  if (session.status === "booked") {
    const reply =
      "Your booking request is already registered. The host will confirm details soon. Message again if you need to change something.";
    session.messages.push({
      role: "assistant",
      content: reply,
      at: new Date().toISOString(),
    });
    saveSession(session);
    return { reply, session, booked: true };
  }

  const slotState = `Current slots JSON: ${JSON.stringify(session.slots)}\nMissing: ${
    missingSlots(session.slots).join(", ") || "none"
  }`;

  const model = getGemini().getGenerativeModel({
    model: config.geminiModel,
    systemInstruction: `${SYSTEM_PROMPT}\n\n${slotState}`,
    tools: [{ functionDeclarations }],
  });

  const chat = model.startChat({
    history: toGeminiHistory(session),
  });

  let booked = false;
  let handoff: string | undefined;
  let finalReply = "";
  let pendingParts: string | Part[] = userText;

  for (let round = 0; round < 4; round++) {
    const result = await chat.sendMessage(pendingParts);
    const response = result.response;
    const calls = response.functionCalls?.() || [];

    if (calls.length) {
      const fnResponses: Part[] = [];
      for (const call of calls) {
        const name = call.name;
        const args = (call.args || {}) as Record<string, unknown>;
        let toolResult: Record<string, unknown> = {};

        if (name === "update_slots") {
          session.slots = mergeSlots(session.slots, args as Partial<DealSlots>);
          saveSession(session);
          toolResult = {
            ok: true,
            slots: session.slots,
            missing: missingSlots(session.slots),
          };
        } else if (name === "create_deal") {
          const missing = missingSlots(session.slots);
          if (args.confirm !== true) {
            toolResult = { ok: false, error: "confirm must be true" };
          } else if (missing.length) {
            toolResult = { ok: false, error: "missing slots", missing };
          } else {
            const event = await createDealEvent({
              sessionId: session.id,
              channel: session.channel,
              externalUserId: session.externalUserId,
              slots: session.slots,
            });
            session.calendarEventId = event.id;
            session.status = "booked";
            saveSession(session);
            await notifyOwnerDeal({
              sessionId: session.id,
              channel: session.channel,
              externalUserId: session.externalUserId,
              slots: session.slots,
              calendarEventId: event.id,
              calendarLink: event.htmlLink,
              mockCalendar: event.mock,
            });
            booked = true;
            toolResult = {
              ok: true,
              calendarEventId: event.id,
              htmlLink: event.htmlLink,
              mock: Boolean(event.mock),
            };
          }
        } else if (name === "handoff_human") {
          handoff = String(args.reason || "client requested human");
          await notifyOwnerDeal({
            sessionId: session.id,
            channel: session.channel,
            externalUserId: session.externalUserId,
            slots: {
              ...session.slots,
              notes: `${session.slots.notes || ""}\nHANDOFF: ${handoff}`.trim(),
            },
          });
          toolResult = { ok: true, handoff };
        } else {
          toolResult = { ok: false, error: "unknown tool" };
        }

        fnResponses.push({
          functionResponse: {
            name,
            response: toolResult,
          },
        });
      }
      pendingParts = fnResponses;
      continue;
    }

    finalReply = (response.text?.() || "").trim();
    break;
  }

  if (!finalReply) {
    finalReply = booked
      ? "Done — I registered your booking request. The host will confirm soon."
      : handoff
        ? "Thanks — I’ve notified the host to continue this chat personally."
        : "Could you share a bit more about what you’re looking for and when?";
  }

  session.messages.push({
    role: "assistant",
    content: finalReply,
    at: new Date().toISOString(),
  });
  saveSession(session);

  return { reply: finalReply, session, booked, handoff };
}
