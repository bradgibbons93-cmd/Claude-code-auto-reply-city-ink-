import crypto from "node:crypto";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "./db.js";
import { artistUploads } from "../drizzle/schema.js";
import { shrinkPhoto, STUDIO_PHOTO } from "./images.js";

/**
 * The artists' end-of-day photos.
 *
 * The whole design constraint is that an artist will do this once, tired, on
 * their phone, between clients. So: no login, no account, no app — a QR code
 * on the wall, pick the photos, type a name, done. Anything more and it won't
 * get used, and unused is the same as not built.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export class UploadRejected extends Error {}

export async function saveArtistUpload(input: {
  artistName?: string;
  note?: string;
  contentType: string;
  bytes: Buffer;
}): Promise<{ id: string; url: string }> {
  const contentType = input.contentType.split(";")[0].trim().toLowerCase();
  if (!ALLOWED.has(contentType)) {
    throw new UploadRejected(`${contentType || "That file"} isn't a photo we can take.`);
  }
  if (!input.bytes.length) throw new UploadRejected("That file came through empty.");
  if (input.bytes.length > MAX_BYTES) {
    throw new UploadRejected("That photo is over 8MB — try one straight from the camera roll.");
  }

  // Eight megabytes off a phone camera, a few times a day, kept forever —
  // this is half of why the database only ever grew. Re-encoded before it is
  // hashed, so the id still describes the bytes actually stored and the same
  // photo sent twice still collapses onto one row.
  const shrunk = await shrinkPhoto(input.bytes, contentType, STUDIO_PHOTO);
  if (!shrunk.original) {
    console.log(`[Uploads] Photo from ${input.artistName?.trim() || "an artist"}: ${shrunk.detail}`);
  }

  // Content-addressed: the same photo sent twice is stored once, so a
  // double-tap on a slow connection can't fill the grid with duplicates.
  const id = crypto.createHash("sha256").update(shrunk.bytes).digest("hex").slice(0, 40);

  const db = await getDb();
  await db
    .insert(artistUploads)
    .values({
      id,
      artistName: input.artistName?.trim().slice(0, 190) || null,
      note: input.note?.trim().slice(0, 2000) || null,
      contentType: shrunk.contentType,
      bytes: shrunk.bytes,
    })
    .onDuplicateKeyUpdate({
      // A re-send should refresh who sent it, not error.
      set: { artistName: input.artistName?.trim().slice(0, 190) || null },
    });

  return { id, url: `/api/uploads/${id}` };
}

/** The grid in the dashboard. Bytes are left behind — they're served by URL. */
export async function listArtistUploads(options?: { limit?: number; unusedOnly?: boolean }) {
  const db = await getDb();
  const rows = await db
    .select({
      id: artistUploads.id,
      artistName: artistUploads.artistName,
      note: artistUploads.note,
      usedAt: artistUploads.usedAt,
      createdAt: artistUploads.createdAt,
    })
    .from(artistUploads)
    .where(options?.unusedOnly ? isNull(artistUploads.usedAt) : undefined)
    .orderBy(desc(artistUploads.createdAt))
    .limit(options?.limit ?? 60);

  return rows.map((row) => ({ ...row, url: `/api/uploads/${row.id}` }));
}

export async function readArtistUpload(id: string) {
  const db = await getDb();
  const rows = await db.select().from(artistUploads).where(eq(artistUploads.id, id)).limit(1);
  return rows[0];
}

/** Mark one as used for a post — or put it back if it was marked by mistake. */
export async function markUploadUsed(id: string, used: boolean) {
  const db = await getDb();
  await db
    .update(artistUploads)
    .set({ usedAt: used ? new Date() : null })
    .where(eq(artistUploads.id, id));
}

export async function deleteArtistUpload(id: string) {
  const db = await getDb();
  await db.delete(artistUploads).where(eq(artistUploads.id, id));
}

/** How many came in today — what the studio actually wants to glance at. */
export async function countUploadsToday(): Promise<number> {
  const db = await getDb();
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(artistUploads)
    .where(gte(artistUploads.createdAt, since));
  return Number(row?.count ?? 0);
}
