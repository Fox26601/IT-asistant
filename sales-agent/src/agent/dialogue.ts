import OpenAI from "openai";
import { config } from "../config.js";
import {
  saveSession,
  type DealSlots,
  type Session,
} from "../db/sessions.js";
import { SYSTEM_PROMPT, SLOT_CHECKLIST } from "./prompts.js";
import { createDealEvent } from "../integrations/googleCalendar.js";
import { notifyOwnerDeal } from "../integrations/ownerNotify.js";

let client: OpenAI | null = null;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl,
    });
  }
  return client;
}

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "update_slots",
      description: "Merge newly learned booking fields into the deal profile",
      parameters: {
        type: "object",
        properties: {
          need: { type: "string" },
          format: { type: "string" },
          budgetOrPackage: { type: "string" },
          preferredDateTime: { type: "string" },
          contact: { type: "string" },
          consentToBook: { type: "boolean" },
          notes: { type: "string" },
          clientName: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_deal",
      description:
        "Register the booking: create Google Calendar event and notify the host. Call only when required slots are filled and consentToBook is true.",
      parameters: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            description: "Must be true to proceed",
          },
        },
        required: ["confirm"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "handoff_human",
      description: "Flag that a human should take over",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
        required: ["reason"],
      },
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

  const openai = getClient();
  const slotState = `Current slots JSON: ${JSON.stringify(session.slots)}\nMissing: ${
    missingSlots(session.slots).join(", ") || "none"
  }`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: slotState },
    ...session.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    })),
  ];

  let booked = false;
  let handoff: string | undefined;
  let finalReply = "";

  for (let round = 0; round < 4; round++) {
    const completion = await openai.chat.completions.create({
      model: config.openaiModel,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.4,
    });

    const choice = completion.choices[0];
    const msg = choice?.message;
    if (!msg) break;

    if (msg.tool_calls?.length) {
      messages.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      });

      for (const call of msg.tool_calls) {
        const name = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        let toolResult = "";

        if (name === "update_slots") {
          session.slots = mergeSlots(session.slots, args as Partial<DealSlots>);
          saveSession(session);
          toolResult = JSON.stringify({
            ok: true,
            slots: session.slots,
            missing: missingSlots(session.slots),
          });
        } else if (name === "create_deal") {
          const missing = missingSlots(session.slots);
          if (args.confirm !== true) {
            toolResult = JSON.stringify({
              ok: false,
              error: "confirm must be true",
            });
          } else if (missing.length) {
            toolResult = JSON.stringify({
              ok: false,
              error: "missing slots",
              missing,
            });
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
            toolResult = JSON.stringify({
              ok: true,
              calendarEventId: event.id,
              htmlLink: event.htmlLink,
              mock: Boolean(event.mock),
            });
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
          toolResult = JSON.stringify({ ok: true, handoff });
        } else {
          toolResult = JSON.stringify({ ok: false, error: "unknown tool" });
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: toolResult,
        });
      }
      continue;
    }

    finalReply = (msg.content || "").trim();
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
