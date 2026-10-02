import { createHash } from "node:crypto";
import sharp, { type OverlayOptions } from "sharp";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, getSetting, setSetting } from "./db.js";
import { artistUploads, scheduledPosts } from "../drizzle/schema.js";
import { getDataStudioId, getStudio, readBrandAsset, studioIdentity } from "./studios.js";
import { readAttachment, saveImageBytes } from "./attachments.js";
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
export const SHADOWS = ["off", "soft", "strong"] as const;

export type LogoCorner = (typeof LOGO_CORNERS)[number];
export type LogoSize = (typeof LOGO_SIZES)[number];
export type Retouch = (typeof RETOUCHES)[number];
export type Shadow = (typeof SHADOWS)[number];

export interface PostLook {
  corner: LogoCorner;
  size: LogoSize;
  retouch: Retouch;
  shadow: Shadow;
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
  /**
   * The logo drawn on posts, when it isn't the studio's app logo. Brad,
   * 2 October: "reupload the logo ... it has a transparent background ...
   * this will be city ink official logo white png". A white logo is right on
   * a photo and invisible on the app's light themes, so the two are kept
   * apart: this one is only ever drawn on posts.
   */
  logoAssetId: string | null;
}

export const DEFAULT_LOOK: PostLook = { corner: "bottom-right", size: "medium", retouch: "light", shadow: "soft" };
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
      shadow: pick(SHADOWS, look.shadow, DEFAULT_LOOK.shadow),
    },
    since: Number(raw.since) || 0,
    logoAssetId:
      typeof raw.logoAssetId === "string" && /^[0-9a-f]{40}$/.test(raw.logoAssetId) ? raw.logoAssetId : null,
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
  logoAssetId?: string | null;
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

/**
 * The logo that goes on posts: the one uploaded for posts if there is one,
 * otherwise the studio's own. `url` is for showing it in the Gallery card.
 */
export async function logoForPosts(
  settings?: AutoPostSettings
): Promise<{ bytes?: Buffer; url: string | null; custom: boolean }> {
  const s = settings ?? (await getAutoPostSettings());
  if (s.logoAssetId) {
    const asset = await readBrandAsset(s.logoAssetId).catch(() => undefined);
    if (asset?.bytes?.length) {
      return { bytes: Buffer.from(asset.bytes), url: `/api/brand/${s.logoAssetId}`, custom: true };
    }
  }
  const id = await getDataStudioId();
  const studio = id ? await getStudio(id) : undefined;
  const bytes = await studioLogo().catch(() => undefined);
  return { bytes, url: bytes && studio?.logoAssetId ? `/api/brand/${studio.logoAssetId}` : null, custom: false };
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

/**
 * The shadow under the logo, so a white logo still has an edge on a pale arm.
 *
 * Brad, 2 October, on the first posts: "the shadow on the logo is way to
 * dark". It was the logo's shape at 60% black under a tight blur, which on
 * skin read as a dark smudge boxed round the letters. Soft is the default
 * now — a faint, wide halo you notice only when it's missing — and the
 * studio can turn it off or up in Gallery → Photos into posts.
 */
const SHADOW: Record<Shadow, null | { opacity: number; spread: number; drop: number }> = {
  off: null,
  soft: { opacity: 0.3, spread: 0.26, drop: 0.012 },
  strong: { opacity: 0.55, spread: 0.2, drop: 0.025 },
};

/**
 * Brad, 2 October: "make it into a square version and also a 1080 x 1920 for
 * insta stories". The square is the post; the story is made alongside it to
 * be saved and posted by hand — Runnit can't publish a story. Portrait (4:5)
 * is for a post made by hand, where the photo editor offers it: it is the
 * tallest shape Facebook and Instagram show in the feed without cropping.
 */
export const POST_FORMATS = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
  story: { width: 1080, height: 1920 },
} as const;
export type PostFormat = keyof typeof POST_FORMATS;
export const FORMATS = Object.keys(POST_FORMATS) as PostFormat[];
/** The two pictures a post made from an artist's upload carries. */
const POST_PICTURES = ["square", "story"] as const satisfies readonly PostFormat[];
type PostPicture = (typeof POST_PICTURES)[number];

/**
 * Where the photo sits in its frame, as CSS's object-position does it: 0 to 1
 * on each axis, the share of the spare room that goes before the photo. 0.5,
 * 0.5 is centred. Using the browser's own rule means the editor's preview and
 * the JPEG made here put the photo in exactly the same place.
 *
 * `zoom` is how big the photo is drawn, against the size at which the WHOLE
 * photo just fits the frame: 1 shows all of it (over the blurred backdrop),
 * and the photo fills the frame from `coverZoom` up. Left out, it is the old
 * behaviour — fill if the photo is close to the frame's shape, else whole.
 */
export interface FramePosition {
  x: number;
  y: number;
  zoom?: number;
}

/** One format's framing, as last drawn. */
export interface FormatFraming extends FramePosition {
  /** The photo fills the frame (cropped), rather than shown whole over a blur. */
  fill: boolean;
  /** Placed by hand. False: sharp chose it, and may choose again on a redraw. */
  set: boolean;
}
export type PostFraming = Partial<Record<PostPicture, FormatFraming>>;

/**
 * Brightness, contrast and saturation as multipliers (1 = as it came). The
 * photo editor's sliders. When a photo has these, they replace the studio's
 * colour touch-up preset rather than stacking on it.
 */
export interface Adjust {
  brightness: number;
  contrast: number;
  saturation: number;
}
export const ADJUST_RANGE = {
  brightness: [0.5, 1.5],
  contrast: [0.5, 1.5],
  saturation: [0, 2],
} as const;

/** The logo for one photo, chosen in the editor over the studio's defaults. */
export interface LogoChoice {
  on: boolean;
  corner: LogoCorner;
  size: LogoSize;
  shadow: Shadow;
}

/** A photo's own choices. Anything left out falls back to the studio's look. */
export interface PhotoStyle {
  adjust?: Adjust;
  logo?: LogoChoice;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function parseFraming(raw: string | null | undefined): PostFraming {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<FormatFraming>>;
    const out: PostFraming = {};
    for (const format of POST_PICTURES) {
      const f = parsed?.[format];
      if (f && typeof f.x === "number" && typeof f.y === "number") {
        out[format] = {
          x: clamp01(f.x),
          y: clamp01(f.y),
          ...(typeof f.zoom === "number" && f.zoom >= 1 ? { zoom: f.zoom } : {}),
          fill: f.fill !== false,
          set: f.set === true,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** The colour touch-up preset as slider values, for the editor to start from. */
export function presetAdjust(retouch: Retouch): Adjust {
  const t = TOUCH[retouch];
  return t
    ? { brightness: t.brightness, contrast: t.contrast, saturation: t.saturation }
    : { brightness: 1, contrast: 1, saturation: 1 };
}

function cleanAdjust(a: Partial<Adjust> | undefined): Adjust | undefined {
  if (!a || typeof a !== "object") return undefined;
  return {
    brightness: round4(clamp(Number(a.brightness ?? 1), ...ADJUST_RANGE.brightness)),
    contrast: round4(clamp(Number(a.contrast ?? 1), ...ADJUST_RANGE.contrast)),
    saturation: round4(clamp(Number(a.saturation ?? 1), ...ADJUST_RANGE.saturation)),
  };
}

function cleanLogo(l: Partial<LogoChoice> | undefined): LogoChoice | undefined {
  if (!l || typeof l !== "object") return undefined;
  return {
    on: l.on !== false,
    corner: pick(LOGO_CORNERS, l.corner, DEFAULT_LOOK.corner),
    size: pick(LOGO_SIZES, l.size, DEFAULT_LOOK.size),
    shadow: pick(SHADOWS, l.shadow, DEFAULT_LOOK.shadow),
  };
}

export function cleanStyle(raw: unknown): PhotoStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { adjust?: Partial<Adjust>; logo?: Partial<LogoChoice> };
  const style: PhotoStyle = {};
  const adjust = cleanAdjust(r.adjust);
  const logo = cleanLogo(r.logo);
  if (adjust) style.adjust = adjust;
  if (logo) style.logo = logo;
  return adjust || logo ? style : undefined;
}

export function parseStyle(raw: string | null | undefined): PhotoStyle | undefined {
  if (!raw) return undefined;
  try {
    return cleanStyle(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

/** The studio's look and logo, with one photo's own choices laid over them. */
function styled(look: PostLook, logo: Buffer | undefined, style: PhotoStyle | undefined) {
  const l = style?.logo;
  return {
    look: l ? { ...look, corner: l.corner, size: l.size, shadow: l.shadow } : look,
    logo: l && !l.on ? undefined : logo,
    adjust: style?.adjust,
  };
}

function placeLogo(corner: LogoCorner, W: number, H: number, w: number, h: number, mx: number, my: number) {
  const left = corner.endsWith("left")
    ? mx
    : corner === "bottom-centre"
      ? Math.round((W - w) / 2)
      : W - w - mx;
  const top = corner.startsWith("top") ? my : H - h - my;
  return { left, top };
}

/**
 * The logo (and its shadow) as layers for a frame of this format. Empty when
 * there is no logo or it won't decode — a logo that won't open costs the
 * logo, never the post.
 */
async function logoLayers(logo: Buffer | undefined, look: PostLook, format: PostFormat): Promise<OverlayOptions[]> {
  if (!logo?.length) return [];
  const { width: W, height: H } = POST_FORMATS[format];
  const short = Math.min(W, H);
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
    const shade = SHADOW[look.shadow];
    const pad = shade ? Math.max(3, Math.round(Math.min(lw, lh) * shade.spread)) : 0;
    const drop = shade ? Math.max(1, Math.round(lh * shade.drop)) : 0;
    const mx = Math.max(Math.round(short * 0.045), pad + drop + 2);
    const my = format === "story" ? Math.max(mx, Math.round(H * 0.12)) : mx;
    const { left, top } = placeLogo(look.corner, W, H, lw, lh, mx, my);

    const layers: OverlayOptions[] = [];
    if (shade) {
      // The logo's own shape in black, faded and spread wide — not a box.
      // Two pipelines on purpose: sharp runs linear() BEFORE extractChannel()
      // whatever order they're written in, and linear() leaves alpha alone —
      // so in one pipeline the fade never happened, and the first version of
      // this shadow was solid black at the "60%" it claimed. That, not the
      // number, is why it read as a dark box.
      const mask = await sharp(fitted.data).extractChannel(3).png().toBuffer();
      const alpha = await sharp(mask).linear(shade.opacity, 0).png().toBuffer();
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
      const shadow = await sharp(padded).blur(Math.max(0.5, pad / 2)).png().toBuffer();
      layers.push({ input: shadow, left: left - pad + drop, top: top - pad + drop });
    }
    layers.push({ input: fitted.data, left, top });
    return layers;
  } catch (error) {
    console.warn(`[AutoPost] Couldn't put the logo on: ${(error as Error).message}`);
    return [];
  }
}

/**
 * The "tattoo posts" template, in a fixed frame: 1080 square for the feed,
 * 1080x1350 portrait, 1080x1920 for a story. The photo is upright and touched
 * up, and the logo sits in the chosen corner with a faint shadow under it so
 * it reads on a pale arm as well as a black glove.
 *
 * How the photo fills the frame matters more than anything else here,
 * because it is somebody's tattoo and cropping into it ruins the post:
 *   - When the photo is already close to the frame's shape (a phone's 3:4 for
 *     the square, roughly 9:16 for a story) it FILLS the frame. Left to
 *     itself, sharp's attention strategy picks the crop — it keeps the
 *     busiest, most detailed part, which is usually the tattoo.
 *   - Otherwise the WHOLE photo is shown, centred over a blurred, darkened
 *     copy of itself. A 3:4 photo in a story is the usual case: cropping it to
 *     9:16 would cut away almost half the width.
 *
 * `position` is the studio's own say, from the photo editor (Brad: "adjust
 * the position and be able to crop and zoom"): where the photo sits, in CSS
 * object-position terms, and how big. The position actually used comes back
 * either way, so the editor starts from where sharp put it.
 *
 * `adjust` is the editor's brightness, contrast and saturation. It replaces
 * the studio's touch-up preset for this photo; the preset's sharpening stays.
 *
 * Stories keep the logo clear of Instagram's own furniture — the profile
 * bar along the top and the reply box along the bottom — about 230px each.
 */
export async function brandPhoto(
  photo: Buffer,
  look: PostLook,
  logo?: Buffer,
  format: PostFormat = "square",
  position?: FramePosition | null,
  adjust?: Adjust | null
): Promise<{
  bytes: Buffer;
  logoApplied: boolean;
  width: number;
  height: number;
  filled: boolean;
  position: Required<FramePosition>;
}> {
  const meta = await sharp(photo).metadata();
  let base = sharp(photo)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true });
  if (meta.hasAlpha) base = base.flatten({ background: "#ffffff" });
  const preset = TOUCH[look.retouch];
  const colour = adjust ?? preset;
  if (colour && (colour.brightness !== 1 || colour.saturation !== 1)) {
    base = base.modulate({ brightness: colour.brightness, saturation: colour.saturation });
  }
  if (colour && colour.contrast !== 1) base = base.linear(colour.contrast, 128 * (1 - colour.contrast));
  if (preset) base = base.sharpen({ sigma: preset.sharpen });
  const src = await base.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sw = src.info.width;
  const sh = src.info.height;
  const raw = { raw: { width: sw, height: sh, channels: src.info.channels } };

  const { width: W, height: H } = POST_FORMATS[format];
  const aspect = sw / sh;
  const nearShape =
    format === "square" ? aspect >= 0.75 && aspect <= 1.34 : Math.abs(aspect - W / H) / (W / H) <= 0.12;
  // Sizes as multiples of "the whole photo just fits".
  const contain = Math.min(W / sw, H / sh);
  const coverZoom = Math.max(W / sw, H / sh) / contain;
  const maxZoom = coverZoom * 3;

  // The blurred, darkened copy of the photo shown wherever the photo itself
  // doesn't reach. Made small and blown up: a blur that size at 1080x1920 is
  // slow, and the result is the same soft wash.
  const backdrop = async () => {
    const small = await sharp(src.data, raw)
      .resize({ width: Math.round(W / 12), height: Math.round(H / 12), fit: "cover" })
      .blur(2.5)
      .modulate({ brightness: 0.5, saturation: 0.9 })
      .png()
      .toBuffer();
    return sharp(small).resize({ width: W, height: H, fit: "fill" }).removeAlpha().raw().toBuffer();
  };

  let frame: Buffer;
  let placed: Required<FramePosition>;
  let filled: boolean;
  if (!position && nearShape) {
    // Left to sharp: fill, and let attention choose the crop.
    const out = await sharp(src.data, raw)
      .resize({ width: W, height: H, fit: "cover", position: sharp.strategy.attention })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    frame = out.data;
    // sharp reports where its crop landed as a negative offset into the
    // resized photo. Turned into the same 0–1 the editor uses.
    const cw = Math.round(sw * contain * coverZoom);
    const ch = Math.round(sh * contain * coverZoom);
    const info = out.info as { cropOffsetLeft?: number; cropOffsetTop?: number };
    placed = {
      x: cw > W ? clamp01(-(info.cropOffsetLeft ?? 0) / (cw - W)) : 0.5,
      y: ch > H ? clamp01(-(info.cropOffsetTop ?? 0) / (ch - H)) : 0.5,
      zoom: coverZoom,
    };
    filled = true;
  } else {
    // Placed by hand, or shown whole: the photo at `zoom`, slid to x/y. Only
    // the part inside the frame is cut out and scaled, so zooming right in on
    // a big photo never builds a picture several times the frame's size.
    const zoom = clamp(position?.zoom ?? (nearShape ? coverZoom : 1), 1, maxZoom);
    const x = clamp01(position?.x ?? 0.5);
    const y = clamp01(position?.y ?? 0.5);
    const scale = contain * zoom;
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));
    const left = Math.round(x * (W - dw));
    const top = Math.round(y * (H - dh));
    const outX = Math.max(0, left);
    const outY = Math.max(0, top);
    const inX = Math.max(0, -left);
    const inY = Math.max(0, -top);
    const visW = Math.max(1, Math.min(dw - inX, W - outX));
    const visH = Math.max(1, Math.min(dh - inY, H - outY));
    const srcLeft = Math.min(sw - 1, Math.floor(inX / scale));
    const srcTop = Math.min(sh - 1, Math.floor(inY / scale));
    const visible = await sharp(src.data, raw)
      .extract({
        left: srcLeft,
        top: srcTop,
        width: Math.max(1, Math.min(sw - srcLeft, Math.round(visW / scale))),
        height: Math.max(1, Math.min(sh - srcTop, Math.round(visH / scale))),
      })
      .resize({ width: visW, height: visH, fit: "fill" })
      .png()
      .toBuffer();
    filled = dw >= W && dh >= H;
    const under = filled
      ? await sharp({ create: { width: W, height: H, channels: 3, background: { r: 0, g: 0, b: 0 } } }).raw().toBuffer()
      : await backdrop();
    frame = await sharp(under, { raw: { width: W, height: H, channels: 3 } })
      .composite([{ input: visible, left: outX, top: outY }])
      .removeAlpha()
      .raw()
      .toBuffer();
    placed = { x, y, zoom };
  }

  const layers = await logoLayers(logo, look, format);
  const bytes = await sharp(frame, { raw: { width: W, height: H, channels: 3 } })
    .composite(layers)
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  return {
    bytes,
    logoApplied: layers.length > 0,
    width: W,
    height: H,
    filled,
    position: { x: round4(placed.x), y: round4(placed.y), zoom: round4(placed.zoom) },
  };
}

/**
 * Just the logo and its shadow on a see-through frame, for the photo editor:
 * the photo moves underneath and the logo stays put, exactly where the real
 * post will have it. The studio's look unless the editor says otherwise.
 * Drawn at half size — it's a guide.
 */
export async function logoOverlay(format: PostFormat, choice?: LogoChoice): Promise<Buffer> {
  const settings = await getAutoPostSettings();
  const logo = (await logoForPosts(settings).catch(() => undefined))?.bytes;
  const s = styled(settings.look, logo, choice ? { logo: choice } : undefined);
  const { width: W, height: H } = POST_FORMATS[format];
  const full = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(await logoLayers(s.logo, s.look, format))
    .png()
    .toBuffer();
  return sharp(full).resize({ width: Math.round(W / 2) }).png().toBuffer();
}

/**
 * Brad, 2 October, on the Schedule a post form: a button on the photo — "edit
 * or add logo and post" — that opens it up to "adjust the saturation contrast
 * and brightness and adjust the position and be able to crop and zoom".
 *
 * Always drawn from the ORIGINAL — an artist's upload or a photo uploaded from
 * the phone — never from a picture this made before, or every edit would crop
 * a crop and paint a logo over the logo. The editor keeps the original's
 * address and sends it each time. A link to somewhere else on the internet
 * can't be edited: the server doesn't go and fetch strangers' URLs.
 */
export async function editPhotoForPost(
  source: string,
  format: PostFormat,
  position: FramePosition,
  style: PhotoStyle | undefined
): Promise<{ url: string; position: Required<FramePosition>; logoApplied: boolean; width: number; height: number }> {
  const photo = await readSourcePhoto(source);
  const settings = await getAutoPostSettings();
  const logo = await logoForPosts(settings).catch(() => undefined);
  const s = styled(settings.look, logo?.bytes, style);
  const drawn = await brandPhoto(photo, s.look, s.logo, format, position, s.adjust);
  const { url } = await saveImageBytes("image/jpeg", drawn.bytes, "post");
  return { url, position: drawn.position, logoApplied: drawn.logoApplied, width: drawn.width, height: drawn.height };
}

async function readSourcePhoto(source: string): Promise<Buffer> {
  const upload = /^\/api\/uploads\/([0-9a-f]{40})$/.exec(source);
  if (upload) {
    const row = await readArtistUpload(upload[1]);
    if (row?.bytes?.length) return Buffer.from(row.bytes);
    throw new AutoPostRejected("That photo isn't in the gallery any more.");
  }
  const attachment = /^\/api\/attachments\/([0-9a-f]{40})$/.exec(source);
  if (attachment) {
    const row = await readAttachment(attachment[1]);
    if (row?.bytes?.length && String(row.contentType).startsWith("image/")) return Buffer.from(row.bytes);
    throw new AutoPostRejected("That photo isn't there any more. Add it again.");
  }
  throw new AutoPostRejected("That photo is a link to another site, so it can't be edited here. Upload it from your phone instead.");
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

/**
 * Bump when brandPhoto's output changes for the same inputs. Every post still
 * waiting for its OK is then redrawn by itself — that is how the posts already
 * waiting when the shadow was softened got the soft shadow too.
 */
const RENDER_VERSION = 2;

/**
 * Which look a post was drawn in: the template's settings, the logo, and the
 * drawing code's version. A waiting post whose key differs is redrawn.
 */
function lookKey(look: PostLook, logoUrl: string | null): string {
  return createHash("sha1")
    .update(JSON.stringify({ v: RENDER_VERSION, look, logo: logoUrl }))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Both pictures for a post, each in its own framing. A position placed by
 * hand is kept; one sharp chose is chosen afresh. A format that fails keeps
 * whatever it had — the caller decides what "had" means.
 */
async function renderPost(
  photo: Buffer,
  studioLook: PostLook,
  studioLogo: Buffer | undefined,
  framing: PostFraming,
  style?: PhotoStyle
): Promise<{ imageUrl: string | null; storyUrl: string | null; framing: PostFraming; logoApplied: boolean }> {
  const out: PostFraming = { ...framing };
  let imageUrl: string | null = null;
  let storyUrl: string | null = null;
  let logoApplied = false;
  // The post's own colour and logo choices from the editor, over the studio's.
  const { look, logo, adjust } = styled(studioLook, studioLogo, style);
  for (const format of POST_PICTURES) {
    const was = framing[format];
    try {
      const drawn = await brandPhoto(photo, look, logo, format, was?.set ? was : null, adjust);
      const url = (await saveImageBytes("image/jpeg", drawn.bytes, "post")).url;
      if (format === "square") {
        imageUrl = url;
        logoApplied = drawn.logoApplied;
      } else {
        storyUrl = url;
      }
      out[format] = { ...drawn.position, fill: drawn.filled, set: !!was?.set };
    } catch (error) {
      console.warn(`[AutoPost] Couldn't draw the ${format}: ${(error as Error).message}`);
    }
  }
  return { imageUrl, storyUrl, framing: out, logoApplied };
}

async function makePost(
  id: string,
  settings: AutoPostSettings,
  logo: { bytes?: Buffer; url: string | null } | undefined,
  index: number
) {
  const upload = await readArtistUpload(id);
  if (!upload?.bytes?.length) throw new Error("the photo isn't there any more");
  const photo = Buffer.from(upload.bytes);

  // 1. The template: the square for the post, the story to save. A post
  //    without the logo beats no post at all, and a post without the
  //    template at all (the raw upload) beats no post either.
  const drawn = await renderPost(photo, settings.look, logo?.bytes, {});
  const imageUrl = drawn.imageUrl ?? `/api/uploads/${id}`;

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
    storyUrl: drawn.storyUrl,
    framing: JSON.stringify(drawn.framing),
    lookKey: lookKey(settings.look, logo?.url ?? null),
  });
  await markUploadUsed(id, true).catch(() => undefined);
  await settle(id, "done");
  console.log(
    `[AutoPost] ${upload.artistName || "An artist"}'s photo ${id.slice(0, 8)} → waiting for OK, ` +
      `${drawn.logoApplied ? "logo on" : "no logo"}, for ${scheduledAt.toISOString()}`
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

/**
 * Turn these uploads into posts waiting for review. Safe to call twice.
 *
 * Whether the feature is on is decided NOW, as the photo arrives — not when
 * its turn in the queue comes round. It used to be read only at its turn, so
 * a photo sent while it was switched off, queued behind a slow caption, was
 * made into a post anyway if it was switched back on in the meantime. Found
 * by the full test run; `autopost.mjs` now does it on purpose. (processBatch
 * still checks again at its turn, so switching OFF while one waits holds it.)
 */
export function autoPostUploads(ids: string[]): Promise<AutoPostRun> {
  const onWhenSent = getAutoPostSettings()
    .then((s) => s.enabled)
    .catch(() => false);
  const run = queue.then(async () =>
    (await onWhenSent) ? processBatch(ids) : { made: 0, failed: 0, skipped: ids.length }
  );
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
  const logo = await logoForPosts(settings).catch(() => undefined);

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

/* ------------------------------------------------------------------ */
/* Moving the photo, and keeping waiting posts in the current look     */
/* ------------------------------------------------------------------ */

type Affected = [{ affectedRows?: number }];

/**
 * Brad, 2 October: "I want to be able to drag to recenter the picture", then
 * "adjust the saturation contrast and brightness and adjust the position and
 * be able to crop and zoom". The photo editor sends where the photo sits and
 * how big, per picture (null puts it back to sharp's own choice), and the
 * post's own colour and logo (`style`: undefined leaves them, null goes back
 * to the studio's look). Both pictures are drawn again from the ORIGINAL
 * upload — never from the branded JPEG, or every edit would crop a crop and
 * paint a second logo over the first.
 *
 * Only a post still waiting for its OK can be edited: once approved, what goes
 * out is what was approved.
 */
export async function reframePost(
  id: number,
  changes: Partial<Record<PostPicture, FramePosition | null>>,
  style?: PhotoStyle | null
): Promise<{ imageUrl: string | null; storyUrl: string | null; framing: PostFraming }> {
  const db = await getDb();
  const [post] = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, id)).limit(1);
  if (!post) throw new AutoPostRejected("That post isn't there any more.");
  if (post.status !== "review") throw new AutoPostRejected("That one's already approved, so its photo is set.");
  if (!post.uploadId) throw new AutoPostRejected("This post wasn't made from an artist's photo, so there's nothing to move.");
  const upload = await readArtistUpload(post.uploadId);
  if (!upload?.bytes?.length) throw new AutoPostRejected("The original photo isn't there any more.");

  const framing = parseFraming(post.framing);
  for (const format of POST_PICTURES) {
    const change = changes[format];
    if (change === undefined) continue;
    const was = framing[format] ?? { x: 0.5, y: 0.5, fill: true, set: false };
    if (change) {
      const placed: FormatFraming = { ...was, x: round4(clamp01(change.x)), y: round4(clamp01(change.y)), set: true };
      if (typeof change.zoom === "number") placed.zoom = round4(Math.max(1, change.zoom));
      else delete placed.zoom;
      framing[format] = placed;
    } else {
      framing[format] = { ...was, set: false };
    }
  }
  const nextStyle = style === undefined ? parseStyle(post.photoStyle) : (style ?? undefined);

  const settings = await getAutoPostSettings();
  const logo = await logoForPosts(settings).catch(() => undefined);
  const drawn = await renderPost(Buffer.from(upload.bytes), settings.look, logo?.bytes, framing, nextStyle);
  if (!drawn.imageUrl && !drawn.storyUrl) throw new AutoPostRejected("Couldn't redraw that photo. Try again.");
  const imageUrl = drawn.imageUrl ?? post.imageUrl;
  const storyUrl = drawn.storyUrl ?? post.storyUrl;

  // Conditional on still waiting: an approve that landed while this was
  // drawing wins, and its picture stays the one that was approved.
  const [result] = (await db
    .update(scheduledPosts)
    .set({
      imageUrl,
      storyUrl,
      framing: JSON.stringify(drawn.framing),
      photoStyle: nextStyle ? JSON.stringify(nextStyle) : null,
      lookKey: lookKey(settings.look, logo?.url ?? null),
    })
    .where(and(eq(scheduledPosts.id, id), eq(scheduledPosts.status, "review")))) as unknown as Affected;
  if (Number(result?.affectedRows ?? 0) !== 1) {
    throw new AutoPostRejected("That one's already approved, so its photo is set.");
  }
  return { imageUrl, storyUrl, framing: drawn.framing };
}

/**
 * Redraw any post still waiting for its OK that was drawn in an older look —
 * a different corner, size, shadow or logo, or older drawing code. The
 * studio changes the look in the Gallery and goes to Posts; if the posts
 * there still showed the old look, the obvious conclusion is that the change
 * didn't work. Positions placed by hand are kept.
 *
 * Runs through the same one-at-a-time queue as making posts. Each write is
 * conditional on the row being exactly as it was read, so a drag or an
 * approve that lands mid-redraw is never overwritten with a stale picture.
 */
export function redrawWaitingPosts(): Promise<number> {
  const run = queue.then(() => redrawStale());
  queue = run.catch(() => undefined);
  return run;
}

async function redrawStale(): Promise<number> {
  const settings = await getAutoPostSettings();
  const logo = await logoForPosts(settings).catch(() => undefined);
  const key = lookKey(settings.look, logo?.url ?? null);
  const db = await getDb();
  const rows = await db
    .select()
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.status, "review"),
        isNotNull(scheduledPosts.uploadId),
        sql`(${scheduledPosts.lookKey} IS NULL OR ${scheduledPosts.lookKey} <> ${key})`
      )
    )
    .orderBy(scheduledPosts.scheduledAt)
    .limit(20);

  let redrawn = 0;
  for (const post of rows) {
    const unchanged = and(
      eq(scheduledPosts.id, post.id),
      eq(scheduledPosts.status, "review"),
      sql`${scheduledPosts.framing} <=> ${post.framing}`,
      sql`${scheduledPosts.photoStyle} <=> ${post.photoStyle}`,
      sql`${scheduledPosts.lookKey} <=> ${post.lookKey}`
    );
    try {
      const upload = await readArtistUpload(post.uploadId!);
      if (!upload?.bytes?.length) {
        // Nothing to draw from. Marked, so it isn't looked at every sweep.
        await db.update(scheduledPosts).set({ lookKey: key }).where(unchanged);
        continue;
      }
      const drawn = await renderPost(
        Buffer.from(upload.bytes),
        settings.look,
        logo?.bytes,
        parseFraming(post.framing),
        parseStyle(post.photoStyle)
      );
      const [result] = (await db
        .update(scheduledPosts)
        .set({
          imageUrl: drawn.imageUrl ?? post.imageUrl,
          storyUrl: drawn.storyUrl ?? post.storyUrl,
          framing: JSON.stringify(drawn.framing),
          lookKey: key,
        })
        .where(unchanged)) as unknown as Affected;
      if (Number(result?.affectedRows ?? 0) === 1) redrawn += 1;
    } catch (error) {
      console.warn(`[AutoPost] Couldn't redraw post ${post.id}: ${(error as Error).message}`);
    }
  }
  if (redrawn) console.log(`[AutoPost] Redrew ${redrawn} waiting post(s) in the current look`);
  return redrawn;
}

/**
 * After the look is saved, redraw a few seconds later rather than at once:
 * picking a corner, then a size, then a shadow is three saves in as many
 * seconds, and only the last look needs drawing.
 */
let redrawTimer: ReturnType<typeof setTimeout> | undefined;
export function redrawWaitingPostsSoon(delayMs = 4000): void {
  if (redrawTimer) clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => {
    redrawTimer = undefined;
    redrawWaitingPosts().catch((error) =>
      console.warn(`[AutoPost] Redraw failed: ${(error as Error).message}`)
    );
  }, delayMs);
  redrawTimer.unref?.();
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
export async function previewLook(
  look: PostLook,
  format: PostFormat = "square"
): Promise<{ bytes: Buffer; sample: boolean }> {
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
  const logo = (await logoForPosts().catch(() => undefined))?.bytes;
  const { bytes } = await brandPhoto(photo, look, logo, format);
  const small = await sharp(bytes).resize({ width: 720, height: 720, fit: "inside" }).jpeg({ quality: 82 }).toBuffer();
  return { bytes: small, sample };
}
