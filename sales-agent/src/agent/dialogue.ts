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
import { trackEscalation } from "../db/escalations.js";
import {
  checkEscalations,
  createEscalation,
  fetchAvailability,
  fetchBookingStatus,
  fetchCatalog,
  fetchCompatiblePractices,
  fetchCustomsStatus,
  fetchPolicy,
  sanitizePolicyForModel,
  type SiteApiResult,
} from "../integrations/siteApi.js";

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
        buyerGender: { type: SchemaType.STRING },
        buyerGenderCustom: { type: SchemaType.STRING },
        topic: { type: SchemaType.STRING },
        source: { type: SchemaType.STRING },
        page: { type: SchemaType.STRING },
        orderId: { type: SchemaType.STRING },
        customsRequestId: { type: SchemaType.STRING },
        meetingType: { type: SchemaType.STRING },
        service: { type: SchemaType.STRING },
        slot: { type: SchemaType.STRING },
        priceUsd: { type: SchemaType.STRING },
      },
    },
  },
  {
    name: "create_deal",
    description:
      "Register a calendar hold and notify the host. Does NOT process payment — checkout is on the website. Call only when required slots are filled and consentToBook is true.",
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
  {
    name: "fetch_catalog",
    description:
      "Load live catalog: prices, packages, creators, boundaries, booking_rules, customs. Call for any price/package/creator question.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "fetch_availability",
    description:
      "Load availability for an explicit buyer date (YYYY-MM-DD). Only offer slots with available: true.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        date: {
          type: SchemaType.STRING,
          description: "Date YYYY-MM-DD from the buyer",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "fetch_policy",
    description:
      "Load operator policy rules. Follow operator_rules; never quote hard_limits to the buyer.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: "fetch_booking_status",
    description: "Look up booking status by order_id from the site",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        order_id: { type: SchemaType.STRING },
      },
      required: ["order_id"],
    },
  },
  {
    name: "fetch_customs_status",
    description: "Look up customs request status by request_id",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        request_id: { type: SchemaType.STRING },
      },
      required: ["request_id"],
    },
  },
  {
    name: "fetch_compatible_practices",
    description:
      "Find practices compatible with given creator ids and/or keys",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        creator_ids: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
        creator_keys: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
      },
    },
  },
  {
    name: "escalate_to_operator",
    description:
      "Ask the site operator when catalog/policy lack an explicit answer. If not_available, fall back to /contact or booking CTAs.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        question: {
          type: SchemaType.STRING,
          description: "One clear question for the operator",
        },
        topic: { type: SchemaType.STRING },
        proposed_answer: {
          type: SchemaType.STRING,
          description: "What you would have guessed if inventing were allowed",
        },
        practice_ids: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
      },
      required: ["question"],
    },
  },
  {
    name: "check_escalations",
    description: "Check status of pending operator escalations by id",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        ids: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
        },
      },
      required: ["ids"],
    },
  },
];

function buildEscalationContext(session: Session): string {
  const recent = session.messages.slice(-6).map((m) => {
    const role = m.role === "assistant" ? "assistant" : "user";
    return `${role}: ${m.content.slice(0, 400)}`;
  });
  return [
    `slots: ${JSON.stringify(session.slots)}`,
    ...recent,
  ].join("\n");
}

function extractEscalationId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;
  const id = obj.escalation_id ?? obj.id;
  return id != null && String(id).trim() ? String(id) : undefined;
}

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
  while (history.length && history[0].role !== "user") {
    history.shift();
  }
  return history;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((x) => String(x)).filter(Boolean);
}

function siteToolPayload(result: SiteApiResult): Record<string, unknown> {
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || "site_error",
      status: result.status,
      data: result.data,
    };
  }
  return {
    ok: true,
    status: result.status,
    data: result.data,
  };
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

  async function sendWithRetry(parts: string | Part[]) {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await chat.sendMessage(parts);
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const retryable = /\b(503|429|high demand|unavailable|try again)\b/i.test(
          msg
        );
        if (!retryable || attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  for (let round = 0; round < 6; round++) {
    const result = await sendWithRetry(pendingParts);
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
              checkoutNote:
                "Payment/checkout only on site paths /book, /customs, /browse",
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
        } else if (name === "fetch_catalog") {
          toolResult = siteToolPayload(await fetchCatalog());
        } else if (name === "fetch_availability") {
          const date = String(args.date || "").trim();
          if (!date) {
            toolResult = {
              ok: false,
              error: "date_required",
              hint: "Ask the buyer for an explicit date first",
            };
          } else {
            toolResult = siteToolPayload(await fetchAvailability(date));
          }
        } else if (name === "fetch_policy") {
          const policy = await fetchPolicy();
          toolResult = siteToolPayload({
            ...policy,
            data: policy.ok
              ? sanitizePolicyForModel(policy.data)
              : policy.data,
          });
        } else if (name === "fetch_booking_status") {
          const orderId = String(
            args.order_id || session.slots.orderId || ""
          ).trim();
          if (!orderId) {
            toolResult = { ok: false, error: "order_id_required" };
          } else {
            toolResult = siteToolPayload(await fetchBookingStatus(orderId));
          }
        } else if (name === "fetch_customs_status") {
          const requestId = String(
            args.request_id || session.slots.customsRequestId || ""
          ).trim();
          if (!requestId) {
            toolResult = { ok: false, error: "request_id_required" };
          } else {
            toolResult = siteToolPayload(await fetchCustomsStatus(requestId));
          }
        } else if (name === "fetch_compatible_practices") {
          toolResult = siteToolPayload(
            await fetchCompatiblePractices({
              creator_ids: asStringArray(args.creator_ids),
              creator_keys: asStringArray(args.creator_keys),
            })
          );
        } else if (name === "escalate_to_operator") {
          const question = String(args.question || "").trim();
          if (!question) {
            toolResult = { ok: false, error: "question_required" };
          } else {
            const created = await createEscalation({
              question,
              topic: args.topic ? String(args.topic) : session.slots.topic,
              proposed_answer: args.proposed_answer
                ? String(args.proposed_answer)
                : undefined,
              context_excerpt: buildEscalationContext(session),
              session_id: session.id,
              practice_ids: asStringArray(args.practice_ids),
            });
            if (!created.ok) {
              toolResult = {
                ...siteToolPayload(created),
                fallback:
                  "Tell buyer you cannot confirm from catalog; suggest /contact or /book|/customs|/browse. Do not promise a follow-up.",
              };
            } else {
              const escalationId = extractEscalationId(created.data);
              if (escalationId) {
                trackEscalation({
                  escalationId,
                  sessionId: session.id,
                  question,
                });
              }
              toolResult = {
                ...siteToolPayload(created),
                escalation_id: escalationId,
                hint: "Tell the buyer you will check with the operator and follow up.",
              };
            }
          }
        } else if (name === "check_escalations") {
          const ids = asStringArray(args.ids) || [];
          if (!ids.length) {
            toolResult = { ok: false, error: "ids_required" };
          } else {
            toolResult = siteToolPayload(await checkEscalations(ids));
          }
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
      ? "Done — I registered your booking request. The host will confirm soon. Checkout stays on the website (/book or /customs)."
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
