import {
  getOrCreateConversation,
  getRecentTurns,
  recordMessage,
  getActiveAutoReplyRules,
  getStudioKnowledge,
  getTimelyConfig,
  pauseBot,
} from "./db.js";
import { invokeLLMJson, type ChatMessage } from "./llm.js";
import { sendMessengerMessage, sendTypingIndicator, getSenderProfile } from "./facebook.js";

const HANDOFF_HOURS = Number(process.env.HANDOFF_PAUSE_HOURS || 12);

type Intent = "booking" | "pricing" | "aftercare" | "artists" | "other";

interface AgentDecision {
  reply: string;
  intent: Intent;
}

/**
 * BUG FIX #5 — the original classified booking intent with keywords like
 * "when", "time", "price" and "cost", so the Timely link fired on nearly
 * every message. The model now decides, and only "booking" sends the link.
 */
async function decide(
  history: ChatMessage[],
  studioFacts: string,
  bookingUrl: string | undefined
): Promise<AgentDecision> {
  const system = `You are the front-of-house assistant for City Ink, a tattoo studio. You reply to Facebook Messenger enquiries.

How to write:
- Two sentences at most. Messenger, not email.
- Warm and straight-talking. No corporate filler, no exclamation-mark spam.
- Never invent prices, dates, artist availability, or policies. If you don't know, say the studio will confirm.
- Never give medical advice. For anything that sounds infected or is not healing, tell them to see a doctor.

What the studio has told you:
${studioFacts || "(nothing configured yet — stay general and defer to the studio)"}

${bookingUrl ? `Booking link (only used when intent is "booking"): ${bookingUrl}` : "No booking link is configured."}

Classify the customer's latest message as exactly one intent:
- "booking" — they want to make, move, or ask about an appointment
- "pricing" — they're asking what something costs
- "aftercare" — healing, washing, peeling, touch-ups
- "artists" — who works there, styles, portfolios
- "other" — anything else

Reply with JSON only, no prose, no code fence:
{"reply": "your message to the customer", "intent": "booking"}`;

  return invokeLLMJson<AgentDecision>(
    [{ role: "system", content: system }, ...history],
    {
      reply: "Thanks for getting in touch — one of the team will come back to you shortly.",
      intent: "other",
    }
  );
}

/** Deterministic rules beat the model. Brad's rules table is the override. */
async function matchRule(text: string) {
  const rules = await getActiveAutoReplyRules();
  const lower = text.toLowerCase();
  return rules.find((rule) =>
    (rule.triggerKeywords || []).some((kw) => lower.includes(kw.toLowerCase()))
  );
}

/**
 * BUG FIX #6 — the original sent one message with no history, so every reply
 * forgot the last. This loads the recent turns first.
 */
export async function handleCustomerMessage(
  senderId: string,
  messageId: string,
  text: string
): Promise<void> {
  const profile = await getSenderProfile(senderId);
  const conversation = await getOrCreateConversation(senderId, profile?.name);

  // BUG FIX #4 — Facebook retries deliveries. A duplicate mid stops here.
  const isNew = await recordMessage(senderId, messageId, "customer", text);
  if (!isNew) {
    console.log(`[Agent] Duplicate delivery ignored: ${messageId}`);
    return;
  }

  // BUG FIX #7 — a human took this thread over, so stay out of it.
  if (conversation?.botPausedUntil && new Date(conversation.botPausedUntil) > new Date()) {
    console.log(`[Agent] Paused on ${senderId} — a person is handling this one`);
    return;
  }

  await sendTypingIndicator(senderId);

  const rule = await matchRule(text);
  const timely = await getTimelyConfig().catch(() => undefined);
  const bookingUrl = timely?.bookingPageUrl;

  let reply: string;
  let shouldSendBooking = false;

  if (rule) {
    reply = rule.responseText;
    shouldSendBooking = !!rule.sendBookingLink && !!bookingUrl;
  } else {
    const knowledge = await getStudioKnowledge().catch(() => []);
    const studioFacts = knowledge.map((k) => `Q: ${k.question}\nA: ${k.answer}`).join("\n\n");

    const turns = await getRecentTurns(senderId, 10);
    const history: ChatMessage[] = turns.map((t) => ({
      role: t.senderType === "customer" ? "user" : "assistant",
      content: t.content,
    }));

    const decision = await decide(history, studioFacts, bookingUrl);
    reply = decision.reply;
    shouldSendBooking = decision.intent === "booking" && !!bookingUrl;
  }

  await sendMessengerMessage(senderId, reply);
  await recordMessage(senderId, `${messageId}_reply`, "bot", reply, reply);

  if (shouldSendBooking) {
    await new Promise((r) => setTimeout(r, 700));
    const bookingMessage = `Here's the booking page — pick a time that suits you: ${bookingUrl}`;
    await sendMessengerMessage(senderId, bookingMessage);
    await recordMessage(senderId, `${messageId}_booking`, "bot", bookingMessage);
  }
}

/**
 * BUG FIX #3 — echo events were never filtered, so the agent could answer its
 * own replies. An echo without app_id means a person typed it in Page Inbox,
 * which is our signal to hand the thread over and go quiet.
 */
export async function handleEcho(
  recipientId: string,
  messageId: string,
  text: string,
  appId?: string | number
): Promise<void> {
  if (appId) return; // our own outgoing message

  await getOrCreateConversation(recipientId);
  const isNew = await recordMessage(recipientId, messageId, "manual", text || "(attachment)");
  if (!isNew) return;

  const until = await pauseBot(recipientId, HANDOFF_HOURS);
  console.log(`[Agent] Human replied to ${recipientId} — paused until ${until.toISOString()}`);
}

export async function generateCaption(prompt: string): Promise<string> {
  const knowledge = await getStudioKnowledge().catch(() => []);
  const facts = knowledge.map((k) => `${k.question}: ${k.answer}`).join("\n");

  const result = await invokeLLMJson<{ caption: string }>(
    [
      {
        role: "system",
        content: `You write Facebook captions for City Ink, a tattoo studio.

Rules:
- Under 60 words.
- Confident and grounded. No hashtag walls — three at most, and only if they earn it.
- Never promise pricing or availability.
- Australian spelling.

Studio context:
${facts || "(none configured)"}

Reply with JSON only: {"caption": "..."}`,
      },
      { role: "user", content: prompt },
    ],
    { caption: "" }
  );

  if (!result.caption) throw new Error("Caption generation failed");
  return result.caption;
}
