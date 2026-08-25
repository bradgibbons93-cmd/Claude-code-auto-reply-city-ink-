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

  if (existing.length > 0) {
    // A conversation created before the name lookup worked would have stayed
    // "Unknown customer" forever, because this returned early and nothing
    // ever wrote the name again. Fill it in the moment one is available.
    if (senderName && !existing[0].senderName) {
      await db
        .update(messengerConversations)
        .set({ senderName })
        .where(eq(messengerConversations.conversationId, conversationId));
      return { ...existing[0], senderName };
    }
    return existing[0];
  }

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
  return rows.filter((row) => !row.senderName?.trim()).map((row) => row.conversationId);
}

export async function setConversationName(conversationId: string, senderName: string) {
  const db = await getDb();
  await db
    .update(messengerConversations)
    .set({ senderName })
    .where(eq(messengerConversations.conversationId, conversationId));
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
  autoReplyContent?: string,
  attachmentUrls?: string[]
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
  isSensitive = false
): Promise<boolean> {
  const db = await getDb();
  try {
    await db
      .insert(pendingReplies)
      .values({ conversationId, customerMessageId, draftText, isSensitive });
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
  if (!drafts.length) return drafts;

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

  return drafts.filter((draft) => {
    const lastReply = answeredAt.get(draft.conversationId);
    if (!lastReply || !draft.createdAt) return true;
    // Something answered this thread after the draft was written.
    return lastReply <= new Date(draft.createdAt).getTime();
  });
}

/** Approves (optionally with edited wording) and returns the text actually sent. */
export async function resolvePendingReply(
  id: number,
  decision: "approved" | "rejected",
  editedText?: string
): Promise<{ conversationId: string; text: string; originalDraft: string } | undefined> {
  const db = await getDb();
  const [row] = await db.select().from(pendingReplies).where(eq(pendingReplies.id, id)).limit(1);
  if (!row || row.status !== "pending") return undefined;

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
