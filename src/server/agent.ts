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
  createPendingReply,
  resolvePendingReply,
  pauseBot,
} from "./db.js";
import { invokeLLMJson, type ChatMessage } from "./llm.js";
import { availabilityForPrompt } from "./calendar.js";
import { sendMessengerMessage, sendTypingIndicator, getSenderProfile } from "./facebook.js";

const HANDOFF_HOURS = Number(process.env.HANDOFF_PAUSE_HOURS || 12);

type Intent = "booking" | "pricing" | "aftercare" | "artists" | "other";

interface AgentDecision {
  reply: string;
  intent: Intent;
  // True when the customer has raised something distressing — illness,
  // bereavement, family violence, money hardship. Brad's instruction: don't
  // answer it, just say the studio will come back to them, and flag it.
  sensitive?: boolean;
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
  hasPhoto: boolean,
  availability: string
): Promise<AgentDecision & { ok: boolean }> {
  const missing = [
    !known.name && "their full name",
    !known.phone && "a phone number",
    !known.dates && "which day(s) or timeframe they'd like",
  ].filter(Boolean);

  const system = `You are answering Facebook Messenger enquiries for City Ink Tattoo Geelong, as if you were Brad or one of the team. Everything you write is reviewed by Brad before it sends, so write it exactly as he would send it.

HOW THE STUDIO ACTUALLY TALKS (match this closely — it's taken from real chats):
- "Hey Amber 😊 thanks for sending this over"
- "Okay cool no worries at all 😊"
- "No worries at all 👌"
- "Yeah 😊 it would take about an hour and a half I'd say, mayb less"
- "Hey Bethany, sorry for the late reply."
- "Let me know whenever your ready and il send over the details"
- "Il get back to you in the next 5 minutes 🙂"
- "Umm roughly an hour"
- "Okay so for two in one hand would be around 200 for the four of them would be around 300"

So: warm, casual, short. First name if you know it. An emoji here and there (😊 👌) but not every message. Contractions and relaxed grammar are fine — this is a text, not an email. Never corporate, never "We appreciate your enquiry". One or two sentences most of the time.

NEVER:
- Invent a price, a date, an artist's availability, or a policy that isn't given to you below.
- Give medical advice. Anything that sounds infected or isn't healing → tell them to see a doctor.
- Promise an appointment time that isn't listed as free below.

STOP AND HAND OVER — this matters more than being helpful:
If the customer mentions anything distressing or personal — illness, hospital, a death, family violence, abuse, mental health, serious money hardship, anything you'd want a human to read first — do NOT try to answer it, comfort them at length, or carry on selling. Set "sensitive": true and make your whole reply a short, kind holding line and nothing more, e.g. "Hey, thanks for letting us know 🙂 someone from the team will get back to you as soon as possible." No price, no booking questions, no advice. A person takes it from there.

WHAT THE STUDIO HAS TOLD YOU (this is your only source of facts):
${studioFacts || "(nothing configured yet — stay general, don't quote prices, defer to the studio)"}

THE BOOKING FLOW — work out which step you're at and do that step:
1. First enquiry / "get a quote" → ask for a reference photo, rough size, and where on the body. Real example: "Please send over any ideas and/ or reference photos along with a rough size and area you would like for the tattoo."
2. Photo + details received → thank them and give a BALLPARK RANGE of about $100 wide, e.g. "Hey ${"${name}"} 😊 thanks for sending this through! You would be looking at about $200 - $250, would that suit you?" Only quote from the price guidance above — if there's none, say the team will confirm a price shortly.
3. They push back on price or give a lower budget → don't just say no. Ask what their budget is, stay warm about it, and only offer a cheaper option if one is actually listed in the studio facts above. If nothing cheaper is listed, do NOT invent an artist, an apprentice, a discount, or a payment plan — say you'll check with the team and come back to them. Real tone: "Okay cool no worries at all 😊 if you have a set budget how much your wanting to spend feel free to let us know and we will see what we can do 👌"
4. Happy with the price → offer times. ${
    availability
      ? `These slots are FREE in the studio calendar right now — offer these exact ones and nothing else: ${availability}. Real example: "Mim can do this at 3pm 🙂 would you like to confirm the booking?"`
      : `You cannot see the calendar right now, so do NOT name a time. Say you'll check and come straight back — real example: "Il get back to you in the next 5 minutes 🙂"`
  }
5. Time agreed → deposit. Real example: "We do just need a $50 deposit, which would leave just $50 on the day. Let me know whenever your ready and il send over the details"
6. Deposit paid → confirm the booking with the address and what to expect on the day.

RETURNING CUSTOMERS: if the history shows they've booked or paid a deposit with you before, open warmly and thank them for coming back.

WHAT YOU'VE COLLECTED SO FAR FOR THIS BOOKING:
- ${
    known.name || known.phone || known.dates
      ? [known.name && `name: ${known.name}`, known.phone && `phone: ${known.phone}`, known.dates && `days they want: ${known.dates}`]
          .filter(Boolean)
          .join("\n- ")
      : "nothing yet"
  }
- Still needed: ${missing.length ? missing.join(", ") : "nothing — everything's in"}
Ask only for what's still missing, one or two things at a time, and never re-ask for something they've already given.
${hasPhoto ? "- They just sent a photo — acknowledge you've got it before anything else." : ""}

Classify the customer's latest message as exactly one intent:
- "booking" — they want to make, move, or ask about an appointment, OR they're answering something you still need (a name, a number, a day) while a booking is already in progress
- "pricing" — asking what something costs
- "aftercare" — healing, washing, peeling, touch-ups
- "artists" — who works there, styles, portfolios
- "other" — anything else

If intent is "booking", pull out anything the LATEST message gives you toward name/phone/dates — leave a field out of "extracted" entirely if this message doesn't mention it.

Reply with JSON only, no prose, no code fence:
{"reply": "your message to the customer", "intent": "booking", "sensitive": false, "extracted": {"name": "...", "phone": "...", "dates": "..."}}`;

  const result = await invokeLLMJson<AgentDecision>(
    [{ role: "system", content: system }, ...history],
    {
      // Only ever seen when the model didn't answer. The caller flags the
      // draft so this can't be mistaken for the agent's own judgement.
      reply: "Thanks for getting in touch — one of the team will come back to you shortly.",
      intent: "other",
    }
  );
  return { ...result.data, ok: result.ok };
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

/** Pings the owner that a draft is sitting in the dashboard waiting on them. */
async function notifyOwnerOfDraft() {
  const config = await getFacebookConfig();
  if (!config?.ownerPsid) return;
  try {
    await sendMessengerMessage(
      config.ownerPsid,
      "A reply is waiting for your OK — open the dashboard's Conversations tab."
    );
  } catch (error) {
    console.error("[Agent] Failed to notify the owner of a pending draft:", (error as Error).message);
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
  console.log(
    `[Agent] Message from ${senderId} (${profile?.name || "name unavailable"}), conversation row ${
      conversation?.id ?? "MISSING"
    }`
  );

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

  // The studio's own account messages the Page to register for alerts and to
  // test things. Drafting a customer reply back at them is noise, and it was
  // the reason the same line kept arriving.
  const config = await getFacebookConfig().catch(() => undefined);
  if (config?.ownerPsid && config.ownerPsid === senderId) {
    console.log("[Agent] Message from the studio's own account — not drafting a reply");
    return;
  }

  await sendTypingIndicator(senderId);

  const rule = await matchRule(text);
  // Read once per message so both branches below see the same free slots.
  const availability = await availabilityForPrompt().catch(() => "");
  const known: BookingState = {
    name: conversation?.bookingName ?? null,
    phone: conversation?.bookingPhone ?? null,
    dates: conversation?.bookingDates ?? null,
  };

  let reply: string;
  let intent: Intent = "other";
  let extracted: AgentDecision["extracted"];
  let sensitive = false;
  let llmFailed = false;

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
    const decision = await decide(history, "", known, photoUrls.length > 0, availability);
    reply = rule.responseText;
    intent = "booking";
    extracted = decision.extracted;
    llmFailed = !decision.ok;
  } else {
    const knowledge = await getStudioKnowledge().catch(() => []);
    const studioFacts = knowledge.map((k) => `Q: ${k.question}\nA: ${k.answer}`).join("\n\n");

    const turns = await getRecentTurns(senderId, 10);
    const history: ChatMessage[] = turns.map((t) => ({
      role: t.senderType === "customer" ? "user" : "assistant",
      content: t.content,
    }));

    const decision = await decide(history, studioFacts, known, photoUrls.length > 0, availability);
    reply = decision.reply;
    intent = decision.intent;
    extracted = decision.extracted;
    sensitive = !!decision.sensitive;
    llmFailed = !decision.ok;

    // A failed call must not look like a considered reply. Say plainly that
    // it needs writing by hand, and flag the row so the dashboard shows it.
    if (llmFailed) {
      reply =
        "[The AI couldn't generate a reply — check LLM_API_KEY in Railway. Write this one yourself.]";
    }
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

  // Nothing reaches a customer without Brad seeing it first — every reply,
  // including fixed Auto-reply text, waits in the dashboard for approval.
  const queued = await createPendingReply(senderId, messageId, reply, sensitive || llmFailed);
  if (queued) {
    console.log(`[Agent] Draft queued for ${senderId} (message ${messageId})`);
    await notifyOwnerOfDraft();
  } else {
    console.warn(`[Agent] Draft already queued for message ${messageId} — skipped`);
  }
}

/** Sends an approved draft (optionally with edited wording) and logs it as sent. */
export async function approveDraft(id: number, editedText?: string): Promise<void> {
  const resolved = await resolvePendingReply(id, "approved", editedText);
  if (!resolved) return;
  await sendMessengerMessage(resolved.conversationId, resolved.text);
  await recordMessage(resolved.conversationId, `draft_${id}_sent`, "bot", resolved.text, resolved.text);
}

/** Discards a draft — nothing is sent to the customer. */
export async function rejectDraft(id: number): Promise<void> {
  await resolvePendingReply(id, "rejected");
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

  const { data: result, ok } = await invokeLLMJson<{ caption: string }>(
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

  if (!ok || !result.caption) throw new Error("Caption generation failed");
  return result.caption;
}
