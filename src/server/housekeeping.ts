import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import {
  artistUploads,
  feedPosts,
  messageAttachments,
  messengerConversations,
  messengerMessages,
  scheduledPosts,
} from "../drizzle/schema.js";
import { readableSize } from "./images.js";

/**
 * Taking things back out of the database, which nothing here has ever done.
 *
 * Every photo this app has ever seen is still in MySQL as a MEDIUMBLOB, and
 * the volume reached 75% before anyone noticed. Compressing on the way in
 * (images.ts) slows the growth; this stops the part of it that was never
 * needed in the first place.
 *
 * The rule this whole file is written around: **a customer's reference photo
 * is never deleted.** A tattoo enquiry usually IS the picture, we have no
 * second copy — Facebook's CDN link died months ago — and losing one is worse
 * than a full disk. So only two things are ever removed, and both of them are
 * things the app can either live without or go and fetch again:
 *
 *  1. **Old feed pictures.** `feed_posts` are the studio's OWN posts, pulled
 *     back off its own Page. The picture is a copy of something still public
 *     on Facebook, the row keeps its permalink, and `syncFeed` re-downloads
 *     anything inside its window. The feed page only ever renders the 60
 *     newest posts (`listFeed`), and a full sync only reaches back 120 days,
 *     so a picture that is outside both is one nothing can display and
 *     nothing will refresh.
 *
 *  2. **Orphans.** Photos uploaded for a scheduled post that was then deleted
 *     or never saved, and feed pictures whose post row has moved on. Nothing
 *     anywhere points at them. A week's grace first, because a picture
 *     uploaded to the post composer is an orphan until the post is saved.
 *
 * Two guards sit under both of those, either of which is enough on its own:
 *
 *  - every candidate must have `conversation_id` of 'feed' or 'post'. A row
 *    written for a customer's message carries that thread's id and can never
 *    be selected here at all;
 *  - and it must not be named by any message, any booking photo, any
 *    scheduled post or any feed post. That matters because these rows are
 *    content-addressed: if a customer ever sent the studio the same image
 *    the studio itself posted, both point at ONE row, and whichever wrote it
 *    first owns the conversation_id. The reference check is what makes the
 *    first guard's answer true rather than merely likely.
 *
 * Safe to run twice, and safe to run while the app is serving: it reads what
 * is referenced, deletes by primary key in one bounded batch, and anything it
 * misses is simply caught on the next run.
 */

/** Only ever these. A real thread's id can't match, which is the point. */
const DELETABLE_OWNERS = ["feed", "post"];

/** What a full `syncFeed` reaches back to; older than this never refreshes. */
const FEED_KEEP_DAYS = 120;

/** What the feed page renders. Newer than this is on screen, so it stays. */
const FEED_KEEP_NEWEST = 60;

/** An unattached upload is not junk yet — someone may be mid-post. */
const ORPHAN_GRACE_DAYS = 7;

/** One run can't lock the table for a minute. The rest waits for tomorrow. */
const MAX_PER_RUN = 500;

export interface PruneReport {
  /** Old feed pictures removed. */
  feedImages: number;
  /** Rows nothing referenced any more. */
  orphans: number;
  bytesFreed: number;
  /** Customer reference photos on the board, none of which were touched. */
  keptCustomerPhotos: number;
  /** Studio gallery photos, which are never pruned — see below. */
  keptGalleryPhotos: number;
  detail: string;
}

/** The `g` flag is stateful, so this is only ever used with matchAll. */
const ATTACHMENT_PATH = /\/api\/attachments\/([A-Za-z0-9_-]+)/g;

/** Every attachment id spoken for, anywhere in the app. */
async function referencedIds(): Promise<Set<string>> {
  const db = await getDb();
  const found = new Set<string>();
  const collect = (value: unknown) => {
    // Both a JSON array and a plain column end up as text here, and a bare
    // regex over it is the honest way to read either without caring which.
    //
    // Deliberately looser than the ids this app writes (40 hex characters).
    // Reading one too many is harmless — it protects a photo that was never
    // in danger. Reading one too few deletes a picture something still points
    // at, and there is no copy. When the two failure modes are that lopsided,
    // over-match.
    for (const [, id] of String(value ?? "").matchAll(ATTACHMENT_PATH)) found.add(id);
  };

  // Only rows that carry a photo at all. On this studio's scale that is
  // hundreds of rows, not millions, and one pass is cheaper and far easier
  // to be sure of than a LIKE per candidate.
  const withPhotos = await db
    .select({ urls: messengerMessages.attachmentUrls })
    .from(messengerMessages)
    .where(isNotNull(messengerMessages.attachmentUrls));
  for (const row of withPhotos) collect(JSON.stringify(row.urls));

  const bookings = await db
    .select({ urls: messengerConversations.bookingPhotoUrls })
    .from(messengerConversations)
    .where(isNotNull(messengerConversations.bookingPhotoUrls));
  for (const row of bookings) collect(JSON.stringify(row.urls));

  const posts = await db
    .select({ url: scheduledPosts.imageUrl })
    .from(scheduledPosts)
    .where(isNotNull(scheduledPosts.imageUrl));
  for (const row of posts) collect(row.url);

  return found;
}

function idFromPath(path: string | null | undefined): string | undefined {
  return /\/api\/attachments\/([A-Za-z0-9_-]+)/.exec(path ?? "")?.[1];
}

/**
 * Take out what is genuinely no longer needed. Returns what it did, in words
 * a person can read, because "pruned 118 rows" says nothing about whether the
 * right rows went.
 */
export async function pruneStoredImages(options?: {
  feedKeepDays?: number;
  feedKeepNewest?: number;
  orphanGraceDays?: number;
  limit?: number;
  now?: Date;
}): Promise<PruneReport> {
  const db = await getDb();
  const now = options?.now ?? new Date();
  const feedKeepDays = options?.feedKeepDays ?? FEED_KEEP_DAYS;
  const feedKeepNewest = options?.feedKeepNewest ?? FEED_KEEP_NEWEST;
  const graceDays = options?.orphanGraceDays ?? ORPHAN_GRACE_DAYS;
  const limit = options?.limit ?? MAX_PER_RUN;

  const referenced = await referencedIds();

  /* ---- 1. Feed pictures past both the window and the screen ---- */

  const feedRows = await db
    .select({ id: feedPosts.id, imagePath: feedPosts.imagePath, postedAt: feedPosts.postedAt })
    .from(feedPosts)
    .where(isNotNull(feedPosts.imagePath))
    .orderBy(desc(feedPosts.postedAt));

  const feedCutoff = new Date(now.getTime() - feedKeepDays * 86_400_000);
  const staleFeed: { postId: string; attachmentId: string }[] = [];
  // Anything a feed post still points at and that is NOT being pruned has to
  // survive the orphan pass below, so keep the whole set to compare against.
  const liveFeedImages = new Set<string>();

  feedRows.forEach((row, index) => {
    const attachmentId = idFromPath(row.imagePath);
    if (!attachmentId) return;
    const onScreen = index < feedKeepNewest;
    const recent = !row.postedAt || new Date(row.postedAt) >= feedCutoff;
    if (onScreen || recent || referenced.has(attachmentId)) {
      liveFeedImages.add(attachmentId);
      return;
    }
    staleFeed.push({ postId: row.id, attachmentId });
  });

  const feedTargets = staleFeed.slice(0, limit).filter((t) => !liveFeedImages.has(t.attachmentId));

  /* ---- 2. Orphans: ours, old enough, and nothing points at them ---- */

  const graceCutoff = new Date(now.getTime() - graceDays * 86_400_000);
  const ourRows = await db
    .select({ id: messageAttachments.id })
    .from(messageAttachments)
    .where(
      and(
        inArray(messageAttachments.conversationId, DELETABLE_OWNERS),
        lt(messageAttachments.createdAt, graceCutoff)
      )
    );

  const feedTargetIds = new Set(feedTargets.map((t) => t.attachmentId));
  const orphanIds = ourRows
    .map((row) => row.id)
    .filter(
      (id) => !referenced.has(id) && !liveFeedImages.has(id) && !feedTargetIds.has(id)
    )
    .slice(0, Math.max(0, limit - feedTargets.length));

  /* ---- 3. Delete, having measured first ---- */

  const doomed = [...feedTargetIds, ...orphanIds];
  let bytesFreed = 0;
  let removed = new Set<string>();

  if (doomed.length) {
    // Ask the database which of these it will actually let go of, rather than
    // assuming. The conversation_id clause is not decoration — it is the last
    // thing standing between a bug in the selection above and a customer's
    // photo — and a row it excludes must not then be counted, or reported, or
    // have a feed post's picture blanked on its behalf.
    const deletable = await db
      .select({
        id: messageAttachments.id,
        size: sql<number>`LENGTH(${messageAttachments.bytes})`,
      })
      .from(messageAttachments)
      .where(
        and(
          inArray(messageAttachments.id, doomed),
          inArray(messageAttachments.conversationId, DELETABLE_OWNERS)
        )
      );

    removed = new Set(deletable.map((row) => row.id));
    bytesFreed = deletable.reduce((total, row) => total + Number(row.size ?? 0), 0);

    if (removed.size) {
      await db
        .delete(messageAttachments)
        .where(
          and(
            inArray(messageAttachments.id, [...removed]),
            inArray(messageAttachments.conversationId, DELETABLE_OWNERS)
          )
        );
    }

    // The post keeps its words, its permalink and its counts — only the
    // picture goes, and the permalink is where the picture still lives.
    for (const target of feedTargets) {
      if (!removed.has(target.attachmentId)) continue;
      await db.update(feedPosts).set({ imagePath: null }).where(eq(feedPosts.id, target.postId));
    }
  }

  // Nothing was going to touch these, but saying how many were left alone is
  // the only way the log proves it.
  const [kept] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(messageAttachments)
    .where(sql`${messageAttachments.conversationId} NOT IN ('feed', 'post')`);
  const [gallery] = await db.select({ count: sql<number>`COUNT(*)` }).from(artistUploads);

  const report: PruneReport = {
    feedImages: feedTargets.filter((t) => removed.has(t.attachmentId)).length,
    orphans: orphanIds.filter((id) => removed.has(id)).length,
    bytesFreed,
    keptCustomerPhotos: Number(kept?.count ?? 0),
    keptGalleryPhotos: Number(gallery?.count ?? 0),
    detail: "",
  };

  report.detail = describe(report, feedKeepDays);
  return report;
}

function describe(report: PruneReport, feedKeepDays: number): string {
  const parts: string[] = [];
  if (report.feedImages) {
    parts.push(
      `${report.feedImages} picture${report.feedImages === 1 ? "" : "s"} from the studio's own ` +
        `posts older than ${feedKeepDays} days (the posts themselves, and their links to ` +
        `Facebook, are untouched)`
    );
  }
  if (report.orphans) {
    parts.push(
      `${report.orphans} photo${report.orphans === 1 ? "" : "s"} nothing points at any more`
    );
  }

  const kept =
    `Left alone: ${report.keptCustomerPhotos} customer reference photo` +
    `${report.keptCustomerPhotos === 1 ? "" : "s"} and ${report.keptGalleryPhotos} ` +
    `studio gallery photo${report.keptGalleryPhotos === 1 ? "" : "s"}.`;

  if (!parts.length) return `Nothing to clear out. ${kept}`;
  return `Freed ${readableSize(report.bytesFreed)} — removed ${parts.join(", and ")}. ${kept}`;
}
