import { config } from "../config.js";
import { getGemini } from "../llm/gemini.js";
import {
  listPendingEscalationIds,
  listPendingEscalations,
  markAnswered,
  markDelivered,
  markDismissed,
  markFailed,
  sessionsForEscalationId,
} from "../db/escalations.js";
import {
  getSessionById,
  saveSession,
} from "../db/sessions.js";
import {
  checkEscalations,
  type EscalationStatusRow,
} from "./siteApi.js";
import {
  notifyOwnerEscalationAnswer,
  sendTelegramMessage,
} from "./ownerNotify.js";

const POLL_MS = 180_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function paraphraseAnswer(input: {
  question: string;
  answer: string;
}): Promise<string> {
  const fallback = `Quick update from the host: ${input.answer.slice(0, 600)}`;
  if (!config.geminiApiKey) return fallback;

  try {
    const model = getGemini().getGenerativeModel({
      model: config.geminiModel,
      systemInstruction: `You rewrite an operator answer for a discreet adult booking assistant.
Rules: paraphrase in the buyer's likely language (match the answer language if clear); 2–4 short sentences; warm and clear; never invent new facts; never quote internal hard limits or limits_text verbatim; do not mention admin panels or escalation ids.`,
    });
    const result = await model.generateContent(
      `Buyer question: ${input.question}\nOperator answer: ${input.answer}\n\nRewrite for the buyer:`
    );
    const text = (result.response.text?.() || "").trim();
    return text || fallback;
  } catch (err) {
    console.error("[escalationPoller] paraphrase failed", err);
    return fallback;
  }
}

async function deliverToSession(input: {
  escalationId: string;
  sessionId: string;
  question: string;
  answer: string;
  followUp: string;
}): Promise<void> {
  const session = getSessionById(input.sessionId);
  if (!session) {
    markFailed(input.escalationId, input.sessionId);
    console.warn(
      `[escalationPoller] session missing ${input.sessionId} for ${input.escalationId}`
    );
    return;
  }

  session.messages.push({
    role: "assistant",
    content: input.followUp,
    at: new Date().toISOString(),
  });
  saveSession(session);

  let deliveredToBuyer = false;
  if (session.channel === "telegram") {
    deliveredToBuyer = await sendTelegramMessage(
      session.externalUserId,
      input.followUp
    );
    if (!deliveredToBuyer) {
      markFailed(input.escalationId, input.sessionId);
      await notifyOwnerEscalationAnswer({
        sessionId: session.id,
        channel: session.channel,
        escalationId: input.escalationId,
        question: input.question,
        answer: input.answer,
        deliveredToBuyer: false,
      });
      return;
    }
  }

  markDelivered(input.escalationId, input.sessionId);
  await notifyOwnerEscalationAnswer({
    sessionId: session.id,
    channel: session.channel,
    escalationId: input.escalationId,
    question: input.question,
    answer: input.answer,
    deliveredToBuyer:
      session.channel === "telegram" ? deliveredToBuyer : false,
  });
}

export async function pollEscalationsOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const pendingIds = listPendingEscalationIds();
    if (!pendingIds.length) return;

    const result = await checkEscalations(pendingIds);
    if (!result.ok) {
      if (result.error !== "not_available") {
        console.warn("[escalationPoller] check failed", result.error);
      }
      return;
    }

    const rows = (result.data as EscalationStatusRow[]) || [];
    for (const row of rows) {
      if (!row.escalation_id) continue;
      const status = String(row.status).toLowerCase();

      if (status === "answered") {
        const answer = (row.answer || "").trim();
        if (!answer) continue;

        markAnswered(row.escalation_id, answer);

        const linked = sessionsForEscalationId(row.escalation_id).filter(
          (r) => r.status === "answered" || r.status === "pending"
        );
        const targets =
          linked.length > 0
            ? linked.filter((r) => r.status !== "delivered")
            : listPendingEscalations().filter(
                (r) => r.escalationId === row.escalation_id
              );

        for (const rec of targets) {
          if (rec.status === "delivered") continue;
          const followUp = await paraphraseAnswer({
            question: rec.question,
            answer,
          });
          await deliverToSession({
            escalationId: rec.escalationId,
            sessionId: rec.sessionId,
            question: rec.question,
            answer,
            followUp,
          });
        }
        continue;
      }

      if (status === "dismissed") {
        markDismissed(row.escalation_id);

        const linked = sessionsForEscalationId(row.escalation_id).filter(
          (r) =>
            r.status === "dismissed" ||
            r.status === "pending" ||
            r.status === "answered"
        );
        const targets = linked.filter((r) => r.status !== "delivered");

        for (const rec of targets) {
          if (rec.status === "delivered") continue;
          const followUp =
            "The host could not confirm that from our catalog. Please use /book or /contact on the site if you still want to continue.";
          await deliverToSession({
            escalationId: rec.escalationId,
            sessionId: rec.sessionId,
            question: rec.question,
            answer: "(dismissed by operator)",
            followUp,
          });
        }
      }
    }
  } catch (err) {
    console.error("[escalationPoller] tick failed", err);
  } finally {
    running = false;
  }
}

export function startEscalationPoller(): void {
  if (timer) return;
  console.log(
    `[escalationPoller] starting (every ${POLL_MS / 1000}s); follows up when site escalations API answers`
  );
  // Kick once shortly after boot, then interval
  setTimeout(() => {
    void pollEscalationsOnce();
  }, 15_000);
  timer = setInterval(() => {
    void pollEscalationsOnce();
  }, POLL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopEscalationPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
