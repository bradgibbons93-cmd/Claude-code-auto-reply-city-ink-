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

/**
 * Store an image the studio supplied directly, rather than one fetched from
 * Facebook — a photo picked off a phone for a scheduled post.
 *
 * Same store, same content-addressing, same /api/attachments path, so a post
 * image behaves exactly like a customer's reference photo once it's in: it
 * survives restarts and the same picture twice is stored once.
 */
export async function saveImageBytes(
  contentType: string,
  bytes: Buffer,
  label = "upload"
): Promise<{ id: string; url: string }> {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (!ALLOWED.has(type)) {
    throw new UnsupportedImage(`${type || "That file"} isn't an image we can use.`);
  }
  if (!bytes.length) throw new UnsupportedImage("That file came through empty.");
  if (bytes.length > MAX_BYTES) {
    throw new UnsupportedImage("That photo is over 8MB — try one straight from the camera roll.");
  }

  const id = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 40);
  const db = await getDb();
  await db
    .insert(messageAttachments)
    .values({ id, conversationId: label, messageId: `${label}_${id}`, contentType: type, bytes })
    .onDuplicateKeyUpdate({ set: { contentType: type } });

  return { id, url: `/api/attachments/${id}` };
}

export class UnsupportedImage extends Error {}

export async function readAttachment(id: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(messageAttachments)
    .where(eq(messageAttachments.id, id))
    .limit(1);
  return rows[0];
}
