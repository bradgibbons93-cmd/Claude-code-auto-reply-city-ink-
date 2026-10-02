import sharp, { type OverlayOptions } from "sharp";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, getSetting, setSetting } from "./db.js";
import { artistUploads, scheduledPosts } from "../drizzle/schema.js";
import { getDataStudioId, getStudio, readBrandAsset, studioIdentity } from "./studios.js";
import { saveImageBytes } from "./attachments.js";
import { generateCaption } from "./agent.js";
import { dayKey, daysAlreadyBooked, fallbackCaptions, planDates } from "./bulk.js";
import { readArtistUpload, markUploadUsed } from "./uploads.js";
import { notify, notifyOnce, clearAlert } from "./push.js";
import type { ChatImage } from "./llm.js";

/**
 * An artist's photo, straight into Posts with the studio's logo on it.
 *
 * Brad, 2 October: "when an artist uploads a photo into that upload section,
 * I want that to trigger and send to Claude or Canva to a template I have set
 * up called tattoo posts — this is a template that basically just adds the
 * tattoo studio logo over the images and retouches the colour. If it could
 * then put it into the scheduler with a simple caption same as all our other
 * posts, that would be amazing."
 *
 * Canva was looked at first and is not the route: filling a Canva template
 * from outside Canva (the Connect "autofill" API) is Enterprise-only, and the
 * server has no Canva session to do it with. The template's job is small and
 * exact — logo in a corner, a touch more colour — so it is done here with
 * sharp, which the app already uses for every photo it stores. Nothing to
 * break, nothing to pay for, and it happens the second the photo lands.
 *
 * What it makes is a post in the scheduler with status "review": NOT
 * "scheduled". Only "scheduled" is ever published (getDuePosts), so a post
 * nobody approved cannot go out. These are customers' bodies about to go on a
 * public Page — that is the same rule as every reply in this app: a person
 * reads it first. One tap on the Posts page and it is an ordinary scheduled
 * post.
 *
 * Two paths, like the inbox: the upload route starts it straight away, and a
 * five-minute sweep picks up anything that was missed (a deploy mid-upload, a
 * crash). Each photo is CLAIMED with one conditional UPDATE before anything is
 * made, so the fast path, the sweep, and a re-sent photo (same bytes, same
 * row) can never make two posts of it.
 */

export const LOGO_CORNERS = ["bottom-right", "bottom-left", "bottom-centre", "top-right", "top-left"] as const;
export const LOGO_SIZES = ["small", "medium", "large"] as const;
export const RETOUCHES = ["off", "light", "punchy"] as const;

export type LogoCorner = (typeof LOGO_CORNERS)[number];
export type LogoSize = (typeof LOGO_SIZES)[number];
export type Retouch = (typeof RETOUCHES)[number];

export interface PostLook {
  corner: LogoCorner;
  size: LogoSize;
  retouch: Retouch;
}

export interface AutoPostSettings {
  enabled: boolean;
  /** "HH:MM" on the studio's clock — when the post goes out on its day. */
  time: string;
  look: PostLook;
  /**
   * Uploads before this moment are never swept. Set the first time the
   * feature runs and again whenever it is switched back on — otherwise
   * turning it on would turn the whole back catalogue into posts.
   */
  since: number;
}

export const DEFAULT_LOOK: PostLook = { corner: "bottom-right", size: "medium", retouch: "light" };
const SETTING = "auto_post";

export class AutoPostRejected extends Error {}

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

type LooseSettings = Omit<Partial<AutoPostSettings>, "look"> & { look?: Partial<PostLook> };

function normalise(raw: LooseSettings): AutoPostSettings {
  const look: Partial<PostLook> = raw.look ?? {};
  const time = typeof raw.time === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(raw.time) ? raw.time : "11:00";
  return {
    enabled: raw.enabled !== false,
    time,
    look: {
      corner: pick(LOGO_CORNERS, look.corner, DEFAULT_LOOK.corner),
      size: pick(LOGO_SIZES, look.size, DEFAULT_LOOK.size),
      retouch: pick(RETOUCHES, look.retouch, DEFAULT_LOOK.retouch),
    },
    since: Number(raw.since) || 0,
  };
}

export async function getAutoPostSettings(): Promise<AutoPostSettings> {
  const raw = await getSetting(SETTING).catch(() => undefined);
  let parsed: LooseSettings = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  const settings = normalise(parsed);
  if (!settings.since) {
    // First run: everything already in the gallery stays where it is.
    settings.since = Date.now();
    await setSetting(SETTING, JSON.stringify(settings)).catch(() => undefined);
  }
  return settings;
}

export async function saveAutoPostSettings(input: {
  enabled?: boolean;
  time?: string;
  look?: Partial<PostLook>;
}): Promise<AutoPostSettings> {
  const current = await getAutoPostSettings();
  const next = normalise({
    ...current,
    ...input,
    look: { ...current.look, ...(input.look ?? {}) },
  });
  next.since = !current.enabled && next.enabled ? Date.now() : current.since;
  await setSetting(SETTING, JSON.stringify(next));
  return next;
}

/** The studio's own logo, as uploaded in Settings. Undefined if there isn't one. */
export async function studioLogo(): Promise<Buffer | undefined> {
  const id = await getDataStudioId();
  const studio = id ? await getStudio(id) : undefined;
  if (!studio?.logoAssetId) return undefined;
  const asset = await readBrandAsset(studio.logoAssetId);
  return asset?.bytes?.length ? Buffer.from(asset.bytes) : undefined;
}

/* ------------------------------------------------------------------ */
/* The template                                                        */
/* ------------------------------------------------------------------ */

/** The box the logo is fitted inside, as a share of the photo's SHORT side. */
const LOGO_BOX: Record<LogoSize, { w: number; h: number }> = {
  small: { w: 0.3, h: 0.09 },
  medium: { w: 0.42, h: 0.13 },
  large: { w: 0.55, h: 0.18 },
};

/**
 * Deliberately gentle. Skin is the subject, and a heavy hand turns it orange
 * — "punchy" is as far as it goes. No auto-levels: normalising a photo of a
 * pale forearm on a black glove is exactly how you get a grey forearm.
 */
const TOUCH: Record<Retouch, null | { brightness: number; saturation: number; contrast: number; sharpen: number }> = {
  off: null,
  light: { brightness: 1.02, saturation: 1.08, contrast: 1.06, sharpen: 0.6 },
  punchy: { brightness: 1.04, saturation: 1.18, contrast: 1.12, sharpen: 0.9 },
};

function placeLogo(corner: LogoCorner, W: number, H: number, w: number, h: number, margin: number) {
  const left = corner.endsWith("left")
    ? margin
    : corner === "bottom-centre"
      ? Math.round((W - w) / 2)
      : W - w - margin;
  const top = corner.startsWith("top") ? margin : H - h - margin;
  return { left, top };
}

/**
 * The "tattoo posts" template: the photo upright, touched up, and the
 * studio's logo in the corner with a soft shadow under it so it reads on a
 * pale arm as well as a black glove. Always a JPEG, never larger than 2048px.
 *
 * Two stages on purpose. sharp composites AFTER its colour operations
 * regardless of the order they're written in, and the photo is held as raw
 * pixels between the stages so it is only JPEG-encoded once.
 */
export async function brandPhoto(
  photo: Buffer,
  look: PostLook,
  logo?: Buffer
): Promise<{ bytes: Buffer; logoApplied: boolean; width: number; height: number }> {
  const meta = await sharp(photo).metadata();
  let base = sharp(photo)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true });
  if (meta.hasAlpha) base = base.flatten({ background: "#ffffff" });
  const touch = TOUCH[look.retouch];
  if (touch) {
    base = base
      .modulate({ brightness: touch.brightness, saturation: touch.saturation })
      .linear(touch.contrast, 128 * (1 - touch.contrast))
      .sharpen({ sigma: touch.sharpen });
  }
  const { data, info } = await base.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const short = Math.min(W, H);

  const layers: OverlayOptions[] = [];
  let logoApplied = false;
  if (logo?.length) {
    try {
      const box = LOGO_BOX[look.size];
      const fitted = await sharp(logo)
        .ensureAlpha()
        .resize({
          width: Math.max(40, Math.round(short * box.w)),
          height: Math.max(20, Math.round(short * box.h)),
          fit: "inside",
        })
        .png()
        .toBuffer({ resolveWithObject: true });
      const lw = fitted.info.width;
      const lh = fitted.info.height;
      const pad = Math.max(3, Math.round(Math.min(lw, lh) * 0.18));
      const drop = Math.max(1, Math.round(lh * 0.04));
      const margin = Math.max(Math.round(short * 0.045), pad + drop + 2);
      const { left, top } = placeLogo(look.corner, W, H, lw, lh, margin);

      // The shadow is the logo's own shape in black, softened — not a box.
      const alpha = await sharp(fitted.data).extractChannel(3).linear(0.6, 0).png().toBuffer();
      const silhouette = await sharp({
        create: { width: lw, height: lh, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .joinChannel(alpha)
        .png()
        .toBuffer();
      const padded = await sharp(silhouette)
        .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const shadow = await sharp(padded).blur(Math.max(0.5, pad / 2.2)).png().toBuffer();

      layers.push({ input: shadow, left: left - pad + drop, top: top - pad + drop });
      layers.push({ input: fitted.data, left, top });
      logoApplied = true;
    } catch (error) {
      // A logo that won't decode costs the logo, never the post.
      console.warn(`[AutoPost] Couldn't put the logo on: ${(error as Error).message}`);
    }
  }

  const bytes = await sharp(data, { raw: { width: W, height: H, channels: info.channels } })
    .composite(layers)
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return { bytes, logoApplied, width: W, height: H };
}

/* ------------------------------------------------------------------ */
/* The caption                                                         */
/* ------------------------------------------------------------------ */

/**
 * "A simple caption same as all our other posts." The studio's own recent
 * captions are the style guide — the ones it scheduled or published, never
 * one still waiting for review, or the auto-post would end up copying itself.
 */
async function recentCaptions(limit = 5): Promise<string[]> {
  const db = await getDb();
  const rows = await db
    .select({ content: scheduledPosts.content })
    .from(scheduledPosts)
    .where(inArray(scheduledPosts.status, ["scheduled", "published"]))
    .orderBy(desc(scheduledPosts.createdAt), desc(scheduledPosts.id))
    .limit(30);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { content } of rows) {
    const text = content.trim();
    if (!text || text.length > 400 || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

async function photoForModel(photo: Buffer): Promise<ChatImage | undefined> {
  try {
    const small = await sharp(photo)
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { mediaType: "image/jpeg", data: small.toString("base64") };
  } catch {
    return undefined;
  }
}

export async function captionForUpload(
  upload: { artistName?: string | null; note?: string | null; bytes: Buffer },
  index = 0
): Promise<{ caption: string; aiGenerated: boolean }> {
  const artist = upload.artistName?.trim();
  const note = upload.note?.trim();
  const examples = await recentCaptions().catch(() => [] as string[]);
  const image = await photoForModel(upload.bytes);

  const brief = [
    "Write the caption for this photo. It's a tattoo the studio has just finished, going on the studio's Page.",
    artist ? `It was tattooed by ${artist}. Credit them by name.` : "",
    note ? `The artist's note about it: "${note.slice(0, 500)}"` : "",
    "Keep it simple: one or two short lines.",
    examples.length
      ? `Match the style of the studio's recent posts:\n${examples.map((e) => `- ${e}`).join("\n")}`
      : "",
    image
      ? "Only describe what you can actually see in the photo."
      : "You can't see the photo, so don't describe the design.",
    "Never name or describe the client, and never guess what the piece means to them.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const caption = (await generateCaption(brief, { images: image ? [image] : [] })).trim();
    if (caption) return { caption, aiGenerated: true };
  } catch (error) {
    console.warn(`[AutoPost] Caption not written, using a stock line: ${(error as Error).message}`);
  }

  // The same stock lines the bulk scheduler falls back on, plus the credit.
  const me = await studioIdentity();
  const lines = fallbackCaptions([me.name, me.city].filter(Boolean).join(", "));
  const line = note || lines[index % lines.length];
  return { caption: artist ? `${line} Tattooed by ${artist}.` : line, aiGenerated: false };
}

/* ------------------------------------------------------------------ */
/* Making the post                                                     */
/* ------------------------------------------------------------------ */

/** Take this photo for an auto-post. True only for the one caller that won it. */
async function claim(id: string): Promise<boolean> {
  const db = await getDb();
  const [result] = (await db.execute(
    sql`UPDATE artist_uploads
           SET auto_post_state = 'working', auto_post_at = NOW(), auto_post_error = NULL
         WHERE id = ${id}
           AND (auto_post_state IS NULL
                OR (auto_post_state = 'working' AND auto_post_at < NOW() - INTERVAL 10 MINUTE))`
  )) as unknown as [{ affectedRows?: number }];
  return Number(result?.affectedRows ?? 0) === 1;
}

async function settle(id: string, state: "done" | "failed", error?: string) {
  const db = await getDb();
  await db
    .update(artistUploads)
    .set({ autoPostState: state, autoPostError: error ? error.slice(0, 250) : null })
    .where(eq(artistUploads.id, id));
}

/**
 * The next free day at the studio's posting time, on the studio's clock.
 * `ignore` is the post being moved, so its own old day doesn't count as taken.
 */
async function nextFreeSlot(time: string, now = new Date(), ignore?: Date): Promise<Date> {
  const ahead = new Date(now.getTime() + 400 * 86_400_000);
  const taken = await daysAlreadyBooked(new Date(now.getTime() - 86_400_000), ahead).catch(
    () => new Set<string>()
  );
  if (ignore) taken.delete(dayKey(ignore));
  const [at] = planDates(1, { startDate: now, timeOfDay: time, takenDays: taken, now });
  // planDates only comes back empty if 400 days are booked solid.
  return at ?? new Date(now.getTime() + 86_400_000);
}

async function makePost(id: string, settings: AutoPostSettings, logo: Buffer | undefined, index: number) {
  const upload = await readArtistUpload(id);
  if (!upload?.bytes?.length) throw new Error("the photo isn't there any more");
  const photo = Buffer.from(upload.bytes);

  // 1. The template. A post without the logo beats no post at all.
  let imageUrl = `/api/uploads/${id}`;
  let logoApplied = false;
  try {
    const branded = await brandPhoto(photo, settings.look, logo);
    const saved = await saveImageBytes("image/jpeg", branded.bytes, "post");
    imageUrl = saved.url;
    logoApplied = branded.logoApplied;
  } catch (error) {
    console.warn(`[AutoPost] Couldn't brand ${id}, posting it as it came in: ${(error as Error).message}`);
  }

  // 2. The words.
  const { caption, aiGenerated } = await captionForUpload(
    { artistName: upload.artistName, note: upload.note, bytes: photo },
    index
  );

  // 3. Its day. Worked out last, as close to the insert as possible, so two
  //    photos in a row land on two different days (the queue below runs them
  //    one at a time for the same reason).
  const scheduledAt = await nextFreeSlot(settings.time);

  const db = await getDb();
  await db.insert(scheduledPosts).values({
    content: caption,
    imageUrl,
    scheduledAt,
    status: "review",
    aiGenerated,
    uploadId: id,
  });
  await markUploadUsed(id, true).catch(() => undefined);
  await settle(id, "done");
  console.log(
    `[AutoPost] ${upload.artistName || "An artist"}'s photo ${id.slice(0, 8)} → waiting for OK, ` +
      `${logoApplied ? "logo on" : "no logo"}, for ${scheduledAt.toISOString()}`
  );
  return { artist: upload.artistName?.trim() || undefined };
}

export interface AutoPostRun {
  made: number;
  failed: number;
  skipped: number;
}

// One run at a time, so two batches can't both decide Tuesday is free.
let queue: Promise<unknown> = Promise.resolve();

/** Turn these uploads into posts waiting for review. Safe to call twice. */
export function autoPostUploads(ids: string[]): Promise<AutoPostRun> {
  const run = queue.then(() => processBatch(ids));
  queue = run.catch(() => undefined);
  return run;
}

async function processBatch(ids: string[]): Promise<AutoPostRun> {
  const result: AutoPostRun = { made: 0, failed: 0, skipped: 0 };
  if (!ids.length) return result;
  const settings = await getAutoPostSettings();
  if (!settings.enabled) {
    result.skipped = ids.length;
    return result;
  }
  const logo = await studioLogo().catch(() => undefined);

  const artists = new Set<string>();
  const problems: string[] = [];
  for (const [index, id] of [...new Set(ids)].entries()) {
    if (!(await claim(id).catch(() => false))) {
      result.skipped += 1;
      continue;
    }
    try {
      const { artist } = await makePost(id, settings, logo, index);
      if (artist) artists.add(artist);
      result.made += 1;
    } catch (error) {
      const message = (error as Error).message;
      console.error(`[AutoPost] ${id.slice(0, 8)} not made into a post: ${message}`);
      problems.push(message);
      await settle(id, "failed", message).catch(() => undefined);
      result.failed += 1;
    }
  }

  if (result.made) {
    const who = artists.size === 1 ? [...artists][0] : artists.size ? "The artists" : "An artist";
    await notify("post", {
      title: result.made === 1 ? "New post ready to check" : `${result.made} new posts ready to check`,
      body: `${who} sent ${result.made === 1 ? "a photo" : `${result.made} photos`}. Logo's on and the caption's written. Tap to approve${result.made === 1 ? " it" : " them"}.`,
      url: "/posts",
      tag: "autopost",
    }).catch(() => undefined);
    if (!result.failed) await clearAlert("autopost").catch(() => undefined);
  }
  if (result.failed) {
    await notifyOnce("autopost", {
      title: "A photo didn't make it into Posts",
      body: `It's still in the gallery. ${problems[0] ?? ""}`.trim(),
      url: "/gallery",
    }).catch(() => undefined);
  }
  return result;
}

/**
 * The safety net under the upload route: anything sent since the feature was
 * switched on that never got made into a post, or got stuck half-made.
 */
export async function sweepAutoPosts(): Promise<AutoPostRun> {
  const settings = await getAutoPostSettings();
  if (!settings.enabled) return { made: 0, failed: 0, skipped: 0 };
  const db = await getDb();
  const rows = await db
    .select({ id: artistUploads.id })
    .from(artistUploads)
    .where(
      and(
        gte(artistUploads.createdAt, new Date(settings.since)),
        sql`(${artistUploads.autoPostState} IS NULL
             OR (${artistUploads.autoPostState} = 'working'
                 AND ${artistUploads.autoPostAt} < NOW() - INTERVAL 10 MINUTE))`
      )
    )
    .orderBy(artistUploads.createdAt)
    .limit(10);
  if (!rows.length) return { made: 0, failed: 0, skipped: 0 };
  return autoPostUploads(rows.map((r) => r.id));
}

/* ------------------------------------------------------------------ */
/* The studio's OK                                                     */
/* ------------------------------------------------------------------ */

/**
 * Approve a post the auto-post made, with any edits. If its day went by while
 * it waited, it moves to the next free day rather than firing the instant it
 * is approved on top of whatever else is going out.
 */
export async function approveReviewPost(
  id: number,
  edits: { content?: string; scheduledAt?: Date } = {}
): Promise<{ scheduledAt: Date }> {
  const db = await getDb();
  const [post] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id)).limit(1);
  if (!post) throw new AutoPostRejected("That post isn't there any more.");
  if (post.status !== "review") throw new AutoPostRejected("That one has already been dealt with.");

  const content = (edits.content ?? post.content).trim();
  if (!content) throw new AutoPostRejected("Add a caption before approving it.");

  let scheduledAt = edits.scheduledAt ?? new Date(post.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now() + 60_000) {
    scheduledAt = await nextFreeSlot((await getAutoPostSettings()).time, new Date(), new Date(post.scheduledAt));
  }

  const reworded = edits.content !== undefined && content !== post.content.trim();
  // Conditional on still being "review", so two taps (or two phones) can't
  // both approve it with different edits.
  const [result] = (await db
    .update(scheduledPosts)
    .set({
      status: "scheduled",
      content,
      scheduledAt,
      aiGenerated: reworded ? false : !!post.aiGenerated,
    })
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.status, "review")))) as unknown as [
    { affectedRows?: number },
  ];
  if (Number(result?.affectedRows ?? 0) !== 1) {
    throw new AutoPostRejected("That one has already been dealt with.");
  }
  return { scheduledAt };
}

/**
 * Delete a post. If it came from an artist's upload and never went out, the
 * photo goes back to the gallery as unused — the studio said no to the POST,
 * not to the picture. It is never made into a post again by itself.
 */
export async function removePost(id: number): Promise<void> {
  const db = await getDb();
  const [post] = await db
    .select({ uploadId: scheduledPosts.uploadId, status: scheduledPosts.status })
    .from(scheduledPosts)
    .where(eq(scheduledPosts.id, id))
    .limit(1);
  await db.delete(scheduledPosts).where(eq(scheduledPosts.id, id));
  if (post?.uploadId && post.status !== "published") {
    await markUploadUsed(post.uploadId, false).catch(() => undefined);
  }
}

/** How many are waiting, for the Gallery card and the Posts heading. */
export async function countWaiting(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(scheduledPosts)
    .where(eq(scheduledPosts.status, "review"));
  return Number(row?.count ?? 0);
}

/**
 * The template on the studio's latest photo, for the preview in the Gallery —
 * so the corner and size can be chosen by looking, not by guessing.
 */
export async function previewLook(look: PostLook): Promise<{ bytes: Buffer; sample: boolean }> {
  const db = await getDb();
  const [latest] = await db
    .select({ bytes: artistUploads.bytes })
    .from(artistUploads)
    .orderBy(desc(artistUploads.createdAt))
    .limit(1);
  let photo = latest?.bytes?.length ? Buffer.from(latest.bytes) : undefined;
  const sample = !photo;
  if (!photo) {
    photo = await sharp({
      create: { width: 1080, height: 1350, channels: 3, background: { r: 120, g: 104, b: 92 } },
    })
      .jpeg()
      .toBuffer();
  }
  const logo = await studioLogo().catch(() => undefined);
  const { bytes } = await brandPhoto(photo, look, logo);
  const small = await sharp(bytes).resize({ width: 900, height: 900, fit: "inside" }).jpeg({ quality: 82 }).toBuffer();
  return { bytes: small, sample };
}
