import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
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
  type InsertUser,
} from "../drizzle/schema.js";

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
  senderName?: string
) {
  const db = await getDb();

  const existing = await db
    .select()
    .from(messengerConversations)
    .where(eq(messengerConversations.conversationId, conversationId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  await db
    .insert(messengerConversations)
    .values({ conversationId, senderName })
    .onDuplicateKeyUpdate({ set: { lastMessageAt: new Date() } });

  const result = await db
    .select()
    .from(messengerConversations)
    .where(eq(messengerConversations.conversationId, conversationId))
    .limit(1);

  return result[0];
}

export async function getRecentConversations(limit = 30) {
  const db = await getDb();
  return db
    .select()
    .from(messengerConversations)
    .orderBy(desc(messengerConversations.lastMessageAt))
    .limit(limit);
}

export async function getConversationMessages(conversationId: string, limit = 50) {
  const db = await getDb();
  return db
    .select()
    .from(messengerMessages)
    .where(eq(messengerMessages.conversationId, conversationId))
    .orderBy(asc(messengerMessages.createdAt))
    .limit(limit);
}

/** Last N turns, oldest first — this is what gives the agent memory. */
export async function getRecentTurns(conversationId: string, limit = 10) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(messengerMessages)
    .where(eq(messengerMessages.conversationId, conversationId))
    .orderBy(desc(messengerMessages.createdAt))
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
  autoReplyContent?: string
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
    });
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") return false;
    throw error;
  }

  await db
    .update(messengerConversations)
    .set({
      lastMessageAt: new Date(),
      ...(senderType === "customer" ? { lastCustomerMessageAt: new Date() } : {}),
    })
    .where(eq(messengerConversations.conversationId, conversationId));

  return true;
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
export async function createPendingReply(
  conversationId: string,
  customerMessageId: string,
  draftText: string
): Promise<boolean> {
  const db = await getDb();
  try {
    await db.insert(pendingReplies).values({ conversationId, customerMessageId, draftText });
    return true;
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") return false;
    throw error;
  }
}

export async function getPendingReplies() {
  const db = await getDb();
  return db
    .select()
    .from(pendingReplies)
    .where(eq(pendingReplies.status, "pending"))
    .orderBy(asc(pendingReplies.createdAt));
}

/** Approves (optionally with edited wording) and returns the text actually sent. */
export async function resolvePendingReply(
  id: number,
  decision: "approved" | "rejected",
  editedText?: string
): Promise<{ conversationId: string; text: string } | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(pendingReplies).where(eq(pendingReplies.id, id)).limit(1);
  if (!row || row.status !== "pending") return undefined;

  await db
    .update(pendingReplies)
    .set({ status: decision, resolvedAt: new Date() })
    .where(eq(pendingReplies.id, id));

  if (decision !== "approved") return undefined;
  return { conversationId: row.conversationId, text: editedText || row.draftText };
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

export async function setFacebookConfig(input: {
  pageId: string;
  pageAccessToken: string;
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
        appSecret: input.appSecret || existing.appSecret,
        isConfigured: true,
      })
      .where(eq(facebookConfig.id, existing.id));
  } else {
    await db.insert(facebookConfig).values({ ...input, isConfigured: true });
  }
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
