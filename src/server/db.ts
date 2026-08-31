import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  users,
  messengerConversations,
  messengerMessages,
  autoReplyRules,
  scheduledPosts,
  facebookConfig,
  timelyConfig,
  studioKnowledge,
  pendingReplies,
  exampleExchanges,
  draftEdits,
  type InsertUser,
} from "../drizzle/schema.js";

/**
 * Meta hands back "Facebook user" — or "Instagram User" — as the participant's
 * name when the app can't read that person's profile. It is a placeholder
 * wearing a name's clothes, and storing it does more harm than storing
 * nothing: the thread then looks named, so the backfill skips it and the
 * studio is left greeting two different people as "Facebook user" forever.
 *
 * Lives here rather than in facebook.ts because that module already imports
 * this one, and the reverse would close the loop.
 */
export function isPlaceholderName(name: string | undefined | null): boolean {
  const trimmed = name?.trim();
  if (!trimmed) return true;
  return /^(facebook|instagram|messenger)\s+user$/i.test(trimmed);
}

/** A name we'd actually put on a card, or nothing. */
export function realName(name: string | undefined | null): string | undefined {
  return isPlaceholderName(name) ? undefined : name!.trim();
}

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (_db) return _db;
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  }
  const pool = mysql.createPool(process.env.DATABASE_URL);
  _db = drizzle(pool);
  return _db;
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

export async function getOrCreateConversation(
  conversationId: string,
  rawName?: string,
  platform: "facebook" | "instagram" = "facebook"
) {
  const db = await getDb();
  // Sanitised here rather than at each call site, so no caller can write
  // "Facebook user" into a name column by accident — this is the one door
  // every path goes through.
  const senderName = realName(rawName);

  const existing = await db
    .select()
    .from(messengerConversations)
    .where(eq(messengerConversations.conversationId, conversationId))
    .limit(1);

  if (existing.length > 0) {
    // A conversation created before the name lookup worked would have stayed
    // "Unknown customer" forever, because this returned early and nothing
    // ever wrote the name again. Fill it in the moment one is available.
    // Backfill a name, and correct the platform on a thread stored before
    // Instagram was wired up — those were all recorded as "facebook".
    const patch: { senderName?: string; platform?: "facebook" | "instagram" } = {};
    // A stored placeholder is worth overwriting — it isn't anyone's name.
    if (senderName && isPlaceholderName(existing[0].senderName)) patch.senderName = senderName;
    if (platform === "instagram" && existing[0].platform !== "instagram") {
      patch.platform = "instagram";
    }
    if (Object.keys(patch).length) {
      await db
        .update(messengerConversations)
        .set(patch)
        .where(eq(messengerConversations.conversationId, conversationId));
      return { ...existing[0], ...patch };
    }
    return existing[0];
  }

  // Deliberately no lastMessageAt. The column defaults to now, and a thread
  // being imported from three weeks ago would then be stamped "now" before
  // its first message could say otherwise — which is precisely how a hundred
  // old conversations all came to read the same age. Left null, the first
  // recordMessage below sets it from the message itself.
  await db
    .insert(messengerConversations)
    .values({ conversationId, senderName, platform, lastMessageAt: null })
    .onDuplicateKeyUpdate({ set: { conversationId } });

  const result = await db
    .select()
    .from(messengerConversations)
    .where(eq(messengerConversations.conversationId, conversationId))
    .limit(1);

  return result[0];
}

/**
 * Threads still showing as "a customer". Backfilling a name only when the
 * next message arrives is no use to a thread that went quiet 13 hours ago —
 * these are the ones that need looking up on purpose.
 */
export async function getConversationsMissingNames(limit = 50) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(messengerConversations)
    .orderBy(desc(messengerConversations.lastMessageAt))
    .limit(limit);
  // "Facebook user" counts as missing. Meta returns it when the app can't
  // read someone's profile, and treating it as a real name is what left two
  // different people both greeted as "Facebook user" with no way to fix it.
  return rows
    .filter((row) => isPlaceholderName(row.senderName))
    .map((row) => row.conversationId);
}

/**
 * Threads where the customer spoke last and nobody has answered.
 *
 * An imported conversation gets no draft — importing deliberately writes
 * nothing to anyone. But some of those people asked a real question weeks
 * ago and never got a reply, and they're the ones worth the agent's time.
 * Excludes anything already waiting in the queue, and anything the studio
 * has muted.
 */
export async function getUnansweredConversations(limit = 20) {
  const db = await getDb();
  const rows = await db.execute(
    sql`SELECT c.conversation_id AS conversationId
          FROM messenger_conversations c
          JOIN (
            SELECT m1.conversation_id, m1.sender_type
              FROM messenger_messages m1
              JOIN (
                SELECT conversation_id, MAX(id) AS last_id
                  FROM messenger_messages
                 GROUP BY conversation_id
              ) t ON t.last_id = m1.id
          ) last ON last.conversation_id = c.conversation_id
         WHERE last.sender_type = 'customer'
           AND (c.bot_paused_until IS NULL OR c.bot_paused_until < NOW())
           AND NOT EXISTS (
             SELECT 1 FROM pending_replies p
              WHERE p.conversation_id = c.conversation_id AND p.status = 'pending'
           )
         ORDER BY c.last_message_at DESC
         LIMIT ${limit}`
  );
  const list = (rows as unknown as [{ conversationId: string }[]])[0] ?? [];
  return list.map((r) => r.conversationId);
}

/** One thread as it stands, without creating it if it isn't there. */
export async function getConversation(conversationId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(messengerConversations)
    .where(eq(messengerConversations.conversationId, conversationId))
    .limit(1);
  return row;
}

export async function setConversationName(conversationId: string, senderName: string) {
  const db = await getDb();
  await db
    .update(messengerConversations)
    .set({ senderName })
    .where(eq(messengerConversations.conversationId, conversationId));
}

/**
 * The inbox. 30 was fine when there were a dozen threads; with a hundred it
 * silently hid two thirds of the studio's customers, and someone looking for
 * a name they could see in Meta's inbox concluded the app had lost them.
 */
export async function getRecentConversations(limit = 250) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(messengerConversations)
    .orderBy(desc(messengerConversations.lastMessageAt))
    .limit(limit);
  if (!rows.length) return rows.map((r) => ({ ...r, lastSenderType: null as string | null }));

  // Who spoke last in each thread. That single fact is what separates "they
  // asked something and nobody has answered" from "the ball is in their
  // court", which is the split Brad actually works from.
  const ids = rows.map((r) => r.conversationId);
  const [lastRows] = (await db.execute(
    sql`SELECT m.conversation_id AS conversationId, m.sender_type AS senderType
          FROM messenger_messages m
          JOIN (
            SELECT conversation_id, MAX(id) AS last_id
              FROM messenger_messages
             WHERE conversation_id IN ${ids}
             GROUP BY conversation_id
          ) t ON t.last_id = m.id`
  )) as unknown as [{ conversationId: string; senderType: string }[]];

  const lastBy = new Map((lastRows ?? []).map((r) => [r.conversationId, r.senderType]));
  return rows.map((r) => ({
    ...r,
    lastSenderType: lastBy.get(r.conversationId) ?? null,
  }));
}

export async function getConversationMessages(conversationId: string, limit = 50) {
  const db = await getDb();
  return db
    .select()
    .from(messengerMessages)
    .where(eq(messengerMessages.conversationId, conversationId))
    .orderBy(asc(messengerMessages.createdAt), asc(messengerMessages.id))
    .limit(limit);
}

/** Last N turns, oldest first — this is what gives the agent memory. */
export async function getRecentTurns(conversationId: string, limit = 10) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(messengerMessages)
    .where(eq(messengerMessages.conversationId, conversationId))
    // id breaks a same-second tie: several messages can share a timestamp,
    // and without this the order within that second is whatever MySQL feels
    // like returning.
    .orderBy(desc(messengerMessages.createdAt), desc(messengerMessages.id))
    .limit(limit);
  return rows.reverse();
}

/**
 * Returns false when this messageId has already been stored, which means
 * Facebook is retrying a delivery we already handled. Callers must bail out.
 */
export async function recordMessage(
  conversationId: string,
  messageId: string,
  senderType: "customer" | "bot" | "manual",
  content: string,
  autoReplyContent?: string,
  attachmentUrls?: string[],
  // When this was actually said, for messages that didn't arrive live.
  // Importing a thread stamped everything "now", so a conversation pulled in
  // from the Meta inbox had no real order — and these turns are exactly what
  // the agent reads back as history, so it would see the chat inside out.
  createdAt?: Date
): Promise<boolean> {
  const db = await getDb();
  try {
    await db.insert(messengerMessages).values({
      conversationId,
      messageId,
      senderType,
      content,
      autoReplyGenerated: !!autoReplyContent,
      autoReplyContent,
      attachmentUrls: attachmentUrls?.length ? attachmentUrls : undefined,
      ...(createdAt ? { createdAt } : {}),
    });
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") return false;
    throw error;
  }

  /**
   * The clock only ever moves forward.
   *
   * This used to stamp "now" on every message it stored, including a
   * three-week-old one being imported. So each press of Import rewrote every
   * thread's time to the moment of the import, and an inbox of conversations
   * from last month all read "4 minutes ago" — it looked as though the whole
   * thing had been re-imported from scratch, when really only the clock had
   * been overwritten. GREATEST keeps whichever is genuinely later, so old
   * messages arriving late can't pretend to be new.
   */
  const when = createdAt ?? new Date();
  await db
    .update(messengerConversations)
    .set({
      lastMessageAt: sql`GREATEST(COALESCE(${messengerConversations.lastMessageAt}, ${when}), ${when})`,
      ...(senderType === "customer"
        ? {
            lastCustomerMessageAt: sql`GREATEST(COALESCE(${messengerConversations.lastCustomerMessageAt}, ${when}), ${when})`,
          }
        : {}),
    })
    .where(eq(messengerConversations.conversationId, conversationId));

  return true;
}

/**
 * Correct who a stored message was from.
 *
 * recordMessage refuses a message it already has, which is right for
 * Facebook's retries but wrong when a re-import is carrying a correction.
 * The studio's own replies were stored as the customer's, so the agent read
 * its own words back as a question and drafted an answer to them — which is
 * exactly what "the drafts are replying to things they never asked" looks
 * like from the dashboard.
 */
export async function correctMessageSender(
  messageId: string,
  senderType: "customer" | "bot" | "manual"
): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: messengerMessages.id, senderType: messengerMessages.senderType })
    .from(messengerMessages)
    .where(eq(messengerMessages.messageId, messageId))
    .limit(1);
  if (!row || row.senderType === senderType) return false;

  await db
    .update(messengerMessages)
    .set({ senderType })
    .where(eq(messengerMessages.messageId, messageId));
  return true;
}

/**
 * Drafts written against something the studio itself said.
 *
 * Once a message is correctly re-labelled as ours, any draft that was
 * answering it is nonsense and needs to go — leaving them would have Brad
 * approving replies to his own sentences.
 */
export async function dropDraftsAnsweringOurselves(): Promise<number> {
  const db = await getDb();
  const [result] = (await db.execute(
    sql`DELETE p FROM pending_replies p
          JOIN messenger_messages m ON m.message_id = p.customer_message_id
         WHERE p.status = 'pending' AND m.sender_type <> 'customer'`
  )) as unknown as [{ affectedRows?: number }];
  return Number(result?.affectedRows ?? 0);
}

/** Human handoff: mute the agent on this thread for a while. */
export async function pauseBot(conversationId: string, hours: number) {
  const db = await getDb();
  const until = new Date(Date.now() + hours * 60 * 60 * 1000);
  await db
    .update(messengerConversations)
    .set({ botPausedUntil: until })
    .where(eq(messengerConversations.conversationId, conversationId));
  return until;
}

export async function resumeBot(conversationId: string) {
  const db = await getDb();
  await db
    .update(messengerConversations)
    .set({ botPausedUntil: null })
    .where(eq(messengerConversations.conversationId, conversationId));
}

/**
 * Manual-booking handoff. Fields accumulate across turns — only the
 * non-empty ones in `patch` overwrite what's stored, so a later message
 * ("actually make it Friday") can update just the dates without wiping
 * the name and phone already collected.
 */
export async function updateBookingDetails(
  conversationId: string,
  patch: { name?: string; phone?: string; dates?: string; newPhotoUrls?: string[] }
) {
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(messengerConversations)
    .where(eq(messengerConversations.conversationId, conversationId))
    .limit(1);
  if (!existing) return;

  const mergedPhotos = patch.newPhotoUrls?.length
    ? [...(existing.bookingPhotoUrls || []), ...patch.newPhotoUrls].slice(-8)
    : existing.bookingPhotoUrls;

  await db
    .update(messengerConversations)
    .set({
      bookingName: patch.name || existing.bookingName,
      bookingPhone: patch.phone || existing.bookingPhone,
      bookingDates: patch.dates || existing.bookingDates,
      bookingPhotoUrls: mergedPhotos,
    })
    .where(eq(messengerConversations.conversationId, conversationId));
}

export async function markBookingNotified(conversationId: string) {
  const db = await getDb();
  await db
    .update(messengerConversations)
    .set({ bookingNotifiedAt: new Date() })
    .where(eq(messengerConversations.conversationId, conversationId));
}

export async function setOwnerPsid(psid: string) {
  const db = await getDb();
  const existing = await getFacebookConfig();
  if (!existing) throw new Error("Connect the Facebook Page first.");
  await db
    .update(facebookConfig)
    .set({ ownerPsid: psid })
    .where(eq(facebookConfig.id, existing.id));
}

/* ------------------------------------------------------------------ */
/* Auto-reply rules                                                    */
/* ------------------------------------------------------------------ */

export async function getActiveAutoReplyRules() {
  const db = await getDb();
  return db
    .select()
    .from(autoReplyRules)
    .where(eq(autoReplyRules.isActive, true))
    .orderBy(desc(autoReplyRules.priority));
}

export async function createAutoReplyRule(
  triggerKeywords: string[],
  responseText: string,
  sendBookingLink = false
) {
  const db = await getDb();
  await db
    .insert(autoReplyRules)
    .values({ triggerKeywords, responseText, sendBookingLink });
}

export async function deleteAutoReplyRule(id: number) {
  const db = await getDb();
  await db.delete(autoReplyRules).where(eq(autoReplyRules.id, id));
}

/* ------------------------------------------------------------------ */
/* Studio knowledge                                                    */
/* ------------------------------------------------------------------ */

export async function getStudioKnowledge() {
  const db = await getDb();
  return db
    .select()
    .from(studioKnowledge)
    .where(eq(studioKnowledge.isActive, true));
}

export async function createKnowledge(question: string, answer: string) {
  const db = await getDb();
  await db.insert(studioKnowledge).values({ question, answer });
}

export async function updateKnowledge(id: number, question: string, answer: string) {
  const db = await getDb();
  await db
    .update(studioKnowledge)
    .set({ question, answer })
    .where(eq(studioKnowledge.id, id));
}

export async function deleteKnowledge(id: number) {
  const db = await getDb();
  await db.delete(studioKnowledge).where(eq(studioKnowledge.id, id));
}

/* ------------------------------------------------------------------ */
/* Pending replies — AI drafts waiting for approval before they send   */
/* ------------------------------------------------------------------ */

/**
 * customerMessageId carries a unique index for the same reason messageId
 * does on messenger_messages: Facebook retries deliveries, and without this
 * a retried webhook call would queue a second draft for the same message.
 */
/**
 * Drop any draft still waiting on this conversation.
 *
 * A customer sending three messages in a row produced three drafts, each
 * answering one fragment, and the queue filled with stale ones. The newest
 * draft is written against the whole thread, so it is strictly better than
 * anything it replaces — the older ones are noise and were never seen.
 */
export async function supersedePendingReplies(conversationId: string): Promise<number> {
  const db = await getDb();
  const stale = await db
    .select({ id: pendingReplies.id })
    .from(pendingReplies)
    .where(
      and(eq(pendingReplies.conversationId, conversationId), eq(pendingReplies.status, "pending"))
    );
  if (!stale.length) return 0;
  await db
    .delete(pendingReplies)
    .where(
      and(eq(pendingReplies.conversationId, conversationId), eq(pendingReplies.status, "pending"))
    );
  return stale.length;
}

export async function createPendingReply(
  conversationId: string,
  customerMessageId: string,
  draftText: string,
  isSensitive = false,
  alternatives?: { label: string; text: string }[],
  llmFailed = false
): Promise<boolean> {
  const db = await getDb();
  try {
    await db.insert(pendingReplies).values({
      conversationId,
      customerMessageId,
      draftText,
      isSensitive,
      llmFailed,
      alternatives: alternatives?.length ? alternatives : undefined,
    });
    return true;
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") return false;
    throw error;
  }
}

/**
 * Drafts genuinely still waiting on a decision.
 *
 * A draft is dead the moment anything else answers that thread — another
 * artist typing a reply, or Facebook's own automated response, which fires
 * on the Page without this app being involved. Approving one after the fact
 * sends the customer a second answer to a question already handled.
 *
 * handleEcho() clears them as the reply arrives; this is the safety net for
 * when an echo is missed or lands late, so a stale draft can never be shown.
 */
export async function getPendingReplies() {
  const db = await getDb();
  const drafts = await db
    .select()
    .from(pendingReplies)
    .where(eq(pendingReplies.status, "pending"))
    .orderBy(asc(pendingReplies.createdAt));

  // Same shape on every path — an empty queue must still look like a queue,
  // or the browser's inferred type loses the photos.
  type QueuedDraft = (typeof drafts)[number] & { photoUrls: string[] };
  if (!drafts.length) return [] as QueuedDraft[];

  // When the studio last said something in each of these conversations.
  const conversationIds = [...new Set(drafts.map((d) => d.conversationId))];
  const replies = await db
    .select({
      conversationId: messengerMessages.conversationId,
      at: sql<string>`MAX(${messengerMessages.createdAt})`,
    })
    .from(messengerMessages)
    .where(
      and(
        inArray(messengerMessages.conversationId, conversationIds),
        inArray(messengerMessages.senderType, ["bot", "manual"])
      )
    )
    .groupBy(messengerMessages.conversationId);

  const answeredAt = new Map(
    replies.map((r) => [r.conversationId, r.at ? new Date(r.at).getTime() : 0])
  );

  const live = drafts.filter((draft) => {
    const lastReply = answeredAt.get(draft.conversationId);
    if (!lastReply || !draft.createdAt) return true;
    // Something answered this thread after the draft was written.
    return lastReply <= new Date(draft.createdAt).getTime();
  });

  // One card per person, always the newest.
  //
  // createPendingReply supersedes the previous draft as a new message
  // arrives, but that only governs drafts written since — anything already
  // stacked up stays stacked. Collapsing here fixes the queue as it is, not
  // just the queue from now on. Two cards for the same customer means
  // answering the same person twice.
  const newestPerConversation = new Map<string, (typeof live)[number]>();
  for (const draft of live) {
    const held = newestPerConversation.get(draft.conversationId);
    const at = draft.createdAt ? new Date(draft.createdAt).getTime() : 0;
    const heldAt = held?.createdAt ? new Date(held.createdAt).getTime() : -1;
    // drafts arrive oldest-first, so >= keeps the last one on a tie.
    if (!held || at >= heldAt) newestPerConversation.set(draft.conversationId, draft);
  }

  const queue = [...newestPerConversation.values()];

  // The reference photos belong on the card, not two clicks away — you can't
  // price a tattoo you can't see. They usually arrive a message or two before
  // the question ("(sent a photo)" then "how much for those two?"), so this
  // gathers what the customer has sent across the thread rather than only
  // what's attached to the exact message being answered.
  const photos = await db
    .select({
      conversationId: messengerMessages.conversationId,
      attachmentUrls: messengerMessages.attachmentUrls,
      createdAt: messengerMessages.createdAt,
    })
    .from(messengerMessages)
    .where(
      and(
        inArray(
          messengerMessages.conversationId,
          queue.map((d) => d.conversationId)
        ),
        eq(messengerMessages.senderType, "customer")
      )
    )
    .orderBy(asc(messengerMessages.createdAt));

  const photosByConversation = new Map<string, string[]>();
  for (const row of photos) {
    if (!row.attachmentUrls?.length) continue;
    const held = photosByConversation.get(row.conversationId) ?? [];
    photosByConversation.set(row.conversationId, [...held, ...row.attachmentUrls]);
  }

  return queue.map((draft) => ({
    ...draft,
    photoUrls: [...new Set(photosByConversation.get(draft.conversationId) ?? [])].slice(-4),
  }));
}

/** Approves (optionally with edited wording) and returns the text actually sent. */
/** One waiting draft, for asking the model to write it again. */
export async function getPendingReply(id: number) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(pendingReplies)
    .where(and(eq(pendingReplies.id, id), eq(pendingReplies.status, "pending")))
    .limit(1);
  return row;
}

/**
 * Puts a freshly written draft into a card that's already on the board, so a
 * retry lands where the studio is already looking rather than as a second
 * card for the same person. Clearing llm_failed is the point of the exercise.
 */
export async function replacePendingReplyDraft(
  id: number,
  draft: {
    draftText: string;
    alternatives?: { label: string; text: string }[];
    isSensitive?: boolean;
  }
): Promise<void> {
  const db = await getDb();
  await db
    .update(pendingReplies)
    .set({
      draftText: draft.draftText,
      alternatives: draft.alternatives?.length ? draft.alternatives : null,
      isSensitive: !!draft.isSensitive,
      llmFailed: false,
    })
    .where(and(eq(pendingReplies.id, id), eq(pendingReplies.status, "pending")));
}

export async function resolvePendingReply(
  id: number,
  decision: "approved" | "rejected",
  editedText?: string
): Promise<{ conversationId: string; text: string; originalDraft: string } | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(pendingReplies).where(eq(pendingReplies.id, id)).limit(1);
  if (!row || row.status !== "pending") return undefined;

  // A draft the AI couldn't write is stored empty on purpose. Approving one
  // untouched would send the customer a blank message — and marking it
  // resolved first would lose the card as well. Refuse before either.
  if (decision === "approved" && !(editedText || row.draftText).trim()) {
    throw new Error("There's nothing written in that reply yet.");
  }

  await db
    .update(pendingReplies)
    .set({ status: decision, resolvedAt: new Date() })
    .where(eq(pendingReplies.id, id));

  if (decision !== "approved") return undefined;
  return {
    conversationId: row.conversationId,
    text: editedText || row.draftText,
    // Kept so the caller can tell whether Brad rewrote it before sending.
    originalDraft: row.draftText,
  };
}

/* ------------------------------------------------------------------ */
/* Scheduled posts                                                     */
/* ------------------------------------------------------------------ */

export async function createScheduledPost(
  content: string,
  scheduledAt: Date,
  imageUrl?: string,
  aiGenerated = false
) {
  const db = await getDb();
  await db.insert(scheduledPosts).values({
    content,
    scheduledAt,
    imageUrl,
    aiGenerated,
    status: "scheduled",
  });
}

export async function getScheduledPosts() {
  const db = await getDb();
  return db
    .select()
    .from(scheduledPosts)
    .orderBy(desc(scheduledPosts.scheduledAt))
    .limit(100);
}

/** Posts that are due. Claimed one at a time by the cron worker. */
export async function getDuePosts() {
  const db = await getDb();
  return db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.status, "scheduled"),
        lte(scheduledPosts.scheduledAt, new Date())
      )
    )
    .limit(10);
}

export async function updatePostStatus(
  id: number,
  status: "draft" | "scheduled" | "published" | "failed",
  extra?: { facebookPostId?: string; lastError?: string }
) {
  const db = await getDb();
  await db
    .update(scheduledPosts)
    .set({
      status,
      facebookPostId: extra?.facebookPostId,
      lastError: extra?.lastError ?? null,
      publishedAt: status === "published" ? new Date() : undefined,
    })
    .where(eq(scheduledPosts.id, id));
}

export async function deletePost(id: number) {
  const db = await getDb();
  await db.delete(scheduledPosts).where(eq(scheduledPosts.id, id));
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export async function getFacebookConfig() {
  const db = await getDb();
  const result = await db.select().from(facebookConfig).limit(1);
  return result[0];
}

/**
 * Remember that Facebook delivered something.
 *
 * Never throws: a webhook has already been acknowledged by the time this runs,
 * and losing the record of a delivery is not a reason to lose the delivery.
 */
export async function recordWebhookDelivery(kind: string): Promise<void> {
  try {
    const db = await getDb();
    await db
      .update(facebookConfig)
      .set({ lastDeliveryAt: new Date(), lastDeliveryKind: kind.slice(0, 64) });
  } catch (error) {
    console.warn(`[DB] Couldn't record the webhook delivery: ${(error as Error).message}`);
  }
}

/**
 * Facebook delivered something and we refused it. Counted, because one
 * rejection is a curiosity and forty in an afternoon is the whole problem.
 */
export async function recordWebhookRejection(): Promise<void> {
  try {
    const db = await getDb();
    await db.update(facebookConfig).set({
      lastRejectedAt: new Date(),
      rejectedCount: sql`COALESCE(${facebookConfig.rejectedCount}, 0) + 1`,
    });
  } catch (error) {
    console.warn(`[DB] Couldn't record the rejection: ${(error as Error).message}`);
  }
}

/** Clear the tally once deliveries are being accepted again. */
export async function clearWebhookRejections(): Promise<void> {
  try {
    const db = await getDb();
    await db.update(facebookConfig).set({ rejectedCount: 0, lastRejectedAt: null });
  } catch {
    /* never worth failing a webhook over */
  }
}

export async function getWebhookRejections(): Promise<{ at: string; count: number } | null> {
  const config = await getFacebookConfig().catch(() => undefined);
  if (!config?.lastRejectedAt || !config.rejectedCount) return null;
  return { at: new Date(config.lastRejectedAt).toISOString(), count: config.rejectedCount };
}

export async function getStoredWebhookDelivery(): Promise<{ at: string; kind: string } | null> {
  const config = await getFacebookConfig().catch(() => undefined);
  if (!config?.lastDeliveryAt) return null;
  return {
    at: new Date(config.lastDeliveryAt).toISOString(),
    kind: config.lastDeliveryKind ?? "unknown",
  };
}

export async function setFacebookConfig(input: {
  pageId: string;
  pageAccessToken: string;
  instagramAccessToken?: string;
  /** Which Meta host that token belongs to — see the schema comment. */
  instagramTokenHost?: "facebook" | "instagram";
  appId: string;
  appSecret: string;
  webhookVerifyToken: string;
  pageName?: string;
}) {
  const db = await getDb();
  const existing = await getFacebookConfig();
  if (existing) {
    // Blank token/secret means "keep the one already saved" — the browser
    // never gets the real values back, so it can't show them to re-submit.
    await db
      .update(facebookConfig)
      .set({
        ...input,
        pageAccessToken: input.pageAccessToken || existing.pageAccessToken,
        instagramAccessToken: input.instagramAccessToken || existing.instagramAccessToken,
        // A blank Instagram box keeps the saved token, so it must keep the
        // saved host too — otherwise saving anything else would quietly
        // re-route Instagram to the wrong Meta server.
        instagramTokenHost: input.instagramAccessToken
          ? (input.instagramTokenHost ?? null)
          : existing.instagramTokenHost,
        appSecret: input.appSecret || existing.appSecret,
        isConfigured: true,
      })
      .where(eq(facebookConfig.id, existing.id));
  } else {
    await db.insert(facebookConfig).values({ ...input, isConfigured: true });
  }
}

/**
 * Correct the saved Page ID from what the token actually belongs to.
 *
 * A mistyped Page ID doesn't announce itself: sending replies goes through
 * /me and works fine, while everything addressed to /{page-id} fails with
 * "Object with ID '…' does not exist". The token is the source of truth, so
 * once Facebook tells us who it is, write that down.
 */
export async function updatePageIdentity(pageId: string, pageName?: string) {
  const db = await getDb();
  const existing = await getFacebookConfig();
  if (!existing) return;
  await db
    .update(facebookConfig)
    .set({ pageId, ...(pageName ? { pageName } : {}) })
    .where(eq(facebookConfig.id, existing.id));
}

export async function getTimelyConfig() {
  const db = await getDb();
  const result = await db.select().from(timelyConfig).limit(1);
  return result[0];
}

export async function setTimelyConfig(input: {
  bookingPageUrl: string;
  businessId?: string;
  defaultServiceId?: string;
  calendarIcsUrl?: string;
}) {
  const db = await getDb();
  const existing = await getTimelyConfig();
  if (existing) {
    await db
      .update(timelyConfig)
      .set({ ...input, isConfigured: true })
      .where(eq(timelyConfig.id, existing.id));
  } else {
    await db.insert(timelyConfig).values({ ...input, isConfigured: true });
  }
}

export async function getStats() {
  const db = await getDb();
  const [convs] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messengerConversations);
  const [msgs] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messengerMessages);
  const [bookings] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messengerMessages)
    .where(eq(messengerMessages.senderType, "bot"));
  const [pending] = await db
    .select({ count: sql<number>`count(*)` })
    .from(scheduledPosts)
    .where(eq(scheduledPosts.status, "scheduled"));

  return {
    conversations: Number(convs?.count ?? 0),
    messages: Number(msgs?.count ?? 0),
    botReplies: Number(bookings?.count ?? 0),
    pendingPosts: Number(pending?.count ?? 0),
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

/**
 * Everything the dashboard header needs, computed from real rows. Nothing
 * here is estimated — if there's no data yet the number is genuinely 0
 * rather than a plausible-looking placeholder.
 */
export async function getDashboardStats() {
  const db = await getDb();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const [today] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messengerMessages)
    .where(
      and(eq(messengerMessages.senderType, "customer"), gte(messengerMessages.createdAt, dayAgo))
    );

  const [yesterday] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messengerMessages)
    .where(
      and(
        eq(messengerMessages.senderType, "customer"),
        gte(messengerMessages.createdAt, twoDaysAgo),
        lte(messengerMessages.createdAt, dayAgo)
      )
    );

  // A "new booking" is a thread that reached the point of being handed over.
  const [bookings] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messengerConversations)
    .where(gte(messengerConversations.bookingNotifiedAt, dayAgo));

  const [drafts] = await db
    .select({ count: sql<number>`count(*)` })
    .from(pendingReplies)
    .where(eq(pendingReplies.status, "pending"));

  // Median-ish response time: how long approved drafts sat before sending.
  const [responded] = await db
    .select({
      avgMinutes: sql<number>`avg(timestampdiff(minute, created_at, resolved_at))`,
    })
    .from(pendingReplies)
    .where(eq(pendingReplies.status, "approved"));

  // Seven-day message count for the sparkline.
  const series = await db
    .select({
      day: sql<string>`date(created_at)`,
      count: sql<number>`count(*)`,
    })
    .from(messengerMessages)
    .where(gte(messengerMessages.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))
    .groupBy(sql`date(created_at)`)
    .orderBy(sql`date(created_at)`);

  const todayCount = Number(today?.count ?? 0);
  const yesterdayCount = Number(yesterday?.count ?? 0);

  return {
    todayMessages: todayCount,
    messagesDeltaPct:
      yesterdayCount > 0
        ? Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100)
        : null,
    newBookings: Number(bookings?.count ?? 0),
    draftsWaiting: Number(drafts?.count ?? 0),
    avgResponseMinutes:
      responded?.avgMinutes == null ? null : Math.round(Number(responded.avgMinutes)),
    series: series.map((row) => ({ day: String(row.day), count: Number(row.count) })),
  };
}

/* ------------------------------------------------------------------ */
/* Learning from real history and from Brad's edits                    */
/* ------------------------------------------------------------------ */

/** Stable id for a pair, so importing the same export twice is a no-op. */
function fingerprint(customerMessage: string, studioReply: string): string {
  return createHash("sha256")
    .update(`${customerMessage.trim()} ${studioReply.trim()}`)
    .digest("hex")
    .slice(0, 64);
}

export async function importExampleExchanges(
  pairs: Array<{ customerMessage: string; studioReply: string }>,
  source?: string
): Promise<{ imported: number; skipped: number }> {
  const db = await getDb();
  let imported = 0;
  let skipped = 0;

  for (const pair of pairs) {
    const customerMessage = pair.customerMessage.trim();
    const studioReply = pair.studioReply.trim();
    if (!customerMessage || !studioReply) {
      skipped++;
      continue;
    }
    try {
      await db.insert(exampleExchanges).values({
        customerMessage,
        studioReply,
        fingerprint: fingerprint(customerMessage, studioReply),
        source,
      });
      imported++;
    } catch (error: unknown) {
      // Duplicate fingerprint — already imported, which is expected on a
      // re-upload and shouldn't fail the whole batch.
      if ((error as { code?: string })?.code === "ER_DUP_ENTRY") skipped++;
      else throw error;
    }
  }

  return { imported, skipped };
}

export async function countExampleExchanges(): Promise<number> {
  const db = await getDb();
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(exampleExchanges);
  return Number(row?.count ?? 0);
}

export async function clearExampleExchanges() {
  const db = await getDb();
  await db.delete(exampleExchanges);
}

/**
 * The closest past exchanges to what this customer just said.
 *
 * Full-text relevance rather than embeddings: it needs no extra API, no
 * per-message cost, and for a few thousand short enquiries about the same
 * dozen topics it picks the right examples. Falls back to a LIKE scan when
 * the query is all stopwords or too short for the index to match.
 */
export async function findSimilarExchanges(query: string, limit = 4) {
  const db = await getDb();
  const cleaned = query.replace(/[+\-><()~*"@]/g, " ").trim();
  if (cleaned.length < 3) return [];

  const matched = (await db.execute(
    sql`SELECT customer_message AS customerMessage, studio_reply AS studioReply,
               MATCH(customer_message) AGAINST (${cleaned}) AS score
        FROM example_exchanges
        WHERE MATCH(customer_message) AGAINST (${cleaned})
        ORDER BY score DESC
        LIMIT ${limit}`
  )) as unknown as [Array<{ customerMessage: string; studioReply: string }>];

  if (matched[0]?.length) return matched[0];

  const [fallback] = (await db.execute(
    sql`SELECT customer_message AS customerMessage, studio_reply AS studioReply
        FROM example_exchanges
        WHERE customer_message LIKE ${"%" + cleaned.slice(0, 40) + "%"}
        LIMIT ${limit}`
  )) as unknown as [Array<{ customerMessage: string; studioReply: string }>];

  return fallback ?? [];
}

/** Only stores a row when Brad actually changed the wording. */
export async function recordDraftEdit(
  draftText: string,
  sentText: string,
  customerMessage?: string
) {
  if (draftText.trim() === sentText.trim()) return;
  const db = await getDb();
  await db.insert(draftEdits).values({ draftText, sentText, customerMessage });
}

/** The most recent corrections, newest first — shown to the model as fixes. */
export async function getRecentDraftEdits(limit = 5) {
  const db = await getDb();
  return db.select().from(draftEdits).orderBy(desc(draftEdits.createdAt)).limit(limit);
}

/**
 * Fix a correction after the fact.
 *
 * A slip of the thumb while editing a draft — clipping a word off the front,
 * say — gets stored as deliberate phrasing, and corrections outweigh
 * everything else the agent reads. So a wrong one has to be repairable, not
 * just visible.
 */
export async function updateDraftEdit(id: number, sentText: string) {
  const db = await getDb();
  await db.update(draftEdits).set({ sentText }).where(eq(draftEdits.id, id));
}

export async function deleteDraftEdit(id: number) {
  const db = await getDb();
  await db.delete(draftEdits).where(eq(draftEdits.id, id));
}
