import crypto from "node:crypto";
import axios from "axios";
import { eq } from "drizzle-orm";
import { getDb } from "./db.js";
import { messageAttachments } from "../drizzle/schema.js";

/**
 * Keeping the photo, not the link to it.
 *
 * Facebook delivers reference photos as signed CDN URLs that stop working
 * after a while. Stored as URLs they render as blank boxes by the time
 * anyone looks at the draft — which is exactly when they matter, because a
 * tattoo enquiry usually IS the picture and you can't quote what you can't
 * see. So the bytes are pulled down as the message arrives and served from
 * this app instead, where they stay put.
 */

/** Big enough for a phone photo, small enough not to bloat the database. */
const MAX_BYTES = 8 * 1024 * 1024;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic"]);

/**
 * Downloads one photo and returns the path to serve it from, or undefined
 * if it couldn't be fetched. A failure here must never cost us the message:
 * the caller keeps Facebook's original URL as a fallback.
 */
export async function cacheAttachment(
  sourceUrl: string,
  conversationId: string,
  messageId: string
): Promise<string | undefined> {
  try {
    const response = await axios.get<ArrayBuffer>(sourceUrl, {
      responseType: "arraybuffer",
      timeout: 20000,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
    });

    const contentType = String(response.headers["content-type"] ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED.has(contentType)) {
      console.warn(`[Attachments] Skipped ${contentType || "unknown type"} from ${messageId}`);
      return undefined;
    }

    const bytes = Buffer.from(response.data);
    if (!bytes.length || bytes.length > MAX_BYTES) return undefined;

    // Content-addressed, so the same photo sent twice is stored once and a
    // retried webhook delivery can't create a duplicate row.
    const id = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 40);

    const db = await getDb();
    await db
      .insert(messageAttachments)
      .values({ id, conversationId, messageId, contentType, bytes, sourceUrl })
      .onDuplicateKeyUpdate({ set: { messageId } });

    return `/api/attachments/${id}`;
  } catch (error) {
    console.error(
      `[Attachments] Couldn't keep a copy of a photo on ${messageId}: ${(error as Error).message}`
    );
    return undefined;
  }
}

/**
 * Photos for a message, in the order they arrived. Each returns the local
 * path where one is kept; anything that couldn't be downloaded falls back to
 * Facebook's URL, which is better than dropping the photo entirely.
 */
export async function cacheAttachments(
  sourceUrls: string[],
  conversationId: string,
  messageId: string
): Promise<string[]> {
  const kept = await Promise.all(
    sourceUrls.map(async (url) => (await cacheAttachment(url, conversationId, messageId)) ?? url)
  );
  return kept;
}

export async function readAttachment(id: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.id, id))
    .limit(1);
  return rows[0];
}
