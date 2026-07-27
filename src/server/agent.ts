import {
  getOrCreateConversation,
  getRecentTurns,
  recordMessage,
  getActiveAutoReplyRules,
  getStudioKnowledge,
  getFacebookConfig,
  updateBookingDetails,
  markBookingNotified,
  setOwnerPsid,
  pauseBot,
} from "./db.js";
import { invokeLLMJson, type ChatMessage } from "./llm.js";
import { sendMessengerMessage, sendTypingIndicator, getSenderProfile } from "./facebook.js";

const HANDOFF_HOURS = Number(process.env.HANDOFF_PAUSE_HOURS || 12);

type Intent = "booking" | "pricing" | "aftercare" | "artists" | "other";

interface AgentDecision {
  reply: string;
  intent: Intent;
  // Only present when intent is "booking" — whatever the model could pick
  // out of THIS message. Missing/unclear fields come back empty, and the
  // caller merges them onto what earlier messages already gave.
  extracted?: { name?: string; phone?: string; dates?: string };
}

interface BookingState {
  name: string | null;
  phone: string | null;
  dates: string | null;
}

function bookingComplete(state: BookingState): state is Record<keyof BookingState, string> {
  return !!(state.name && state.phone && state.dates);
}

/**
 * BUG FIX #5 — the original classified booking intent with keywords like
 * "when", "time", "price" and "cost", so it fired on nearly every message.
 * The model now decides, and only "booking" runs the collection flow below.
 *
 * Booking is handled manually (Brad enters it into Timely himself), so
 * instead of handing out a link the agent collects name, phone, and
 * preferred dates across the conversation, mentions reference photos are
 * welcome, and stops asking once it has enough for Brad to take over.
 */
async function decide(
  history: ChatMessage[],
  studioFacts: string,
  known: BookingState,
  hasPhoto: boolean
): Promise<AgentDecision> {
  const missing = [
    !known.name && "their full name",
    !known.phone && "a phone number",
    !known.dates && "which day(s) or timeframe they'd like",
  ].filter(Boolean);

  const system = `You are the front-of-house assistant for City Ink, a tattoo studio. You reply to Facebook Messenger enquiries.

How to write:
- Two sentences at most. Messenger, not email.
- Warm and straight-talking. No corporate filler, no exclamation-mark spam.
- Never invent prices, dates, artist availability, or policies. If you don't know, say the studio will confirm.
- Never give medical advice. For anything that sounds infected or is not healing, tell them to see a doctor.

What the studio has told you:
${studioFacts || "(nothing configured yet — stay general and defer to the studio)"}

Bookings are entered by hand, there's no online booking page. When someone wants to book:
- Already collected from them: ${
    known.name || known.phone || known.dates
      ? [known.name && `name: ${known.name}`, known.phone && `phone: ${known.phone}`, known.dates && `dates: ${known.dates}`]
          .filter(Boolean)
          .join(", ")
      : "nothing yet"
  }
- Still needed: ${missing.length ? missing.join(", ") : "nothing — everything's in"}
- Ask only for what's still needed, one or two things at a time. Don't re-ask for what's already given.
- Mention once that a reference photo of what they want is welcome if they have one, but don't insist on it.
${hasPhoto ? "- They just sent an image — acknowledge you've got it." : ""}
- Once everything needed is in, tell them the studio will confirm and be in touch shortly. Don't promise a time yourself.

Classify the customer's latest message as exactly one intent:
- "booking" — they want to make, move, or ask about an appointment. Also
  "booking" if "Still needed" above is non-empty and this message looks like
  it's answering that — a name, a phone number, or a day/date on its own,
  with no booking keyword, still counts once the conversation is already
  mid-booking.
- "pricing" — they're asking what something costs
- "aftercare" — healing, washing, peeling, touch-ups
- "artists" — who works there, styles, portfolios
- "other" — anything else

If intent is "booking", also pull out anything the LATEST message gives you toward name/phone/dates — leave a field out of "extracted" entirely if this message doesn't mention it.

Reply with JSON only, no prose, no code fence:
{"reply": "your message to the customer", "intent": "booking", "extracted": {"name": "...", "phone": "...", "dates": "..."}}`;

  return invokeLLMJson<AgentDecision>(
    [{ role: "system", content: system }, ...history],
    {
      reply: "Thanks for getting in touch — one of the team will come back to you shortly.",
      intent: "other",
    }
  );
}

/** Pings the studio owner's own Messenger thread so they can enter it into Timely. */
async function notifyOwner(details: {
  customerName?: string;
  name: string;
  phone: string;
  dates: string;
  photoUrls: string[];
}) {
  const config = await getFacebookConfig();
  if (!config?.ownerPsid) {
    console.warn(
      '[Agent] A booking is ready but no owner is registered yet. Send "set owner <your webhook verify token>" from your own Messenger to the Page to register.'
    );
    return;
  }

  const lines = [
    "New booking — enter this into Timely:",
    details.customerName ? `Messenger: ${details.customerName}` : undefined,
    `Name: ${details.name}`,
    `Phone: ${details.phone}`,
    `Wants: ${details.dates}`,
    details.photoUrls.length ? `Reference photo(s): ${details.photoUrls.join(" ")}` : undefined,
  ].filter(Boolean);

  try {
    await sendMessengerMessage(config.ownerPsid, lines.join("\n"));
  } catch (error) {
    // The 24-hour Messenger window applies to this thread too — if Brad
    // hasn't messaged the Page recently, this can fail silently on
    // Facebook's side. Logging it is the only fallback short of a second
    // notification channel.
    console.error("[Agent] Failed to alert the owner:", (error as Error).message);
  }
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
  text: string,
  photoUrls: string[] = []
): Promise<void> {
  const profile = await getSenderProfile(senderId);
  const conversation = await getOrCreateConversation(senderId, profile?.name);

  // BUG FIX #4 — Facebook retries deliveries. A duplicate mid stops here.
  const isNew = await recordMessage(senderId, messageId, "customer", text || "(sent a photo)");
  if (!isNew) {
    console.log(`[Agent] Duplicate delivery ignored: ${messageId}`);
    return;
  }

  // BUG FIX #7 — a human took this thread over, so stay out of it.
  if (conversation?.botPausedUntil && new Date(conversation.botPausedUntil) > new Date()) {
    console.log(`[Agent] Paused on ${senderId} — a person is handling this one`);
    return;
  }

  // Self-registration for booking alerts: send this exact phrase from your
  // own Messenger (the token is whatever's in Settings → webhook verify
  // token) and this thread becomes where booking alerts land.
  const ownerCommand = text.trim().match(/^set owner (.+)$/i);
  if (ownerCommand) {
    const config = await getFacebookConfig();
    if (config?.webhookVerifyToken && ownerCommand[1].trim() === config.webhookVerifyToken) {
      await setOwnerPsid(senderId);
      const confirm = "Got it — booking alerts will come to this chat from now on.";
      await sendMessengerMessage(senderId, confirm);
      await recordMessage(senderId, `${messageId}_reply`, "bot", confirm);
      return;
    }
  }

  await sendTypingIndicator(senderId);

  const rule = await matchRule(text);
  const known: BookingState = {
    name: conversation?.bookingName ?? null,
    phone: conversation?.bookingPhone ?? null,
    dates: conversation?.bookingDates ?? null,
  };

  let reply: string;
  let intent: Intent = "other";
  let extracted: AgentDecision["extracted"];

  // A plain rule (no booking flag) is a fixed answer — no need to spend an
  // LLM call on it. A rule marked to start the booking hand-off still uses
  // its own wording, but also runs extraction so the flow below can start
  // collecting name/phone/dates on the same turn.
  if (rule && !rule.sendBookingLink) {
    reply = rule.responseText;
  } else if (rule && rule.sendBookingLink) {
    const turns = await getRecentTurns(senderId, 10);
    const history: ChatMessage[] = turns.map((t) => ({
      role: t.senderType === "customer" ? "user" : "assistant",
      content: t.content,
    }));
    const decision = await decide(history, "", known, photoUrls.length > 0);
    reply = rule.responseText;
    intent = "booking";
    extracted = decision.extracted;
  } else {
    const knowledge = await getStudioKnowledge().catch(() => []);
    const studioFacts = knowledge.map((k) => `Q: ${k.question}\nA: ${k.answer}`).join("\n\n");

    const turns = await getRecentTurns(senderId, 10);
    const history: ChatMessage[] = turns.map((t) => ({
      role: t.senderType === "customer" ? "user" : "assistant",
      content: t.content,
    }));

    const decision = await decide(history, studioFacts, known, photoUrls.length > 0);
    reply = decision.reply;
    intent = decision.intent;
    extracted = decision.extracted;
  }

  if (intent === "booking" || photoUrls.length > 0) {
    await updateBookingDetails(senderId, {
      name: extracted?.name,
      phone: extracted?.phone,
      dates: extracted?.dates,
      newPhotoUrls: photoUrls,
    });

    const merged: BookingState = {
      name: extracted?.name || known.name,
      phone: extracted?.phone || known.phone,
      dates: extracted?.dates || known.dates,
    };

    if (bookingComplete(merged) && !conversation?.bookingNotifiedAt) {
      await notifyOwner({
        customerName: profile?.name,
        name: merged.name,
        phone: merged.phone,
        dates: merged.dates,
        photoUrls: [...(conversation?.bookingPhotoUrls || []), ...photoUrls],
      });
      await markBookingNotified(senderId);
      reply = "Perfect, that's everything — I've passed it to the studio and they'll confirm your appointment shortly.";
    }
  }

  await sendMessengerMessage(senderId, reply);
  await recordMessage(senderId, `${messageId}_reply`, "bot", reply, reply);
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
