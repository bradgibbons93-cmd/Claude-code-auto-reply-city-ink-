import crypto from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, getFacebookConfig, getSetting, setSetting } from "./db.js";
import { brandAssets, studioMembers, studios, users } from "../drizzle/schema.js";
import { shrinkPhoto } from "./images.js";
import { AccountError, getUser, updateUser, type UserRow } from "./accounts.js";

/**
 * Studios, and which of them the inbox belongs to.
 *
 * A login can own several studios (Brad → City Ink Geelong, Melbourne,
 * Sydney), each with its own name, branding and look. What a deployment has
 * exactly ONE of is the Meta connection — the Page token, the webhook, the
 * agent and every conversation that came in through them. That belongs to the
 * studio recorded as `data_studio_id`.
 *
 * So the rule the whole server enforces is simple: the inbox, drafts, posts,
 * settings and agent are readable only by a member of the data studio, while
 * it is the studio they have open. A stranger who signs up gets their own
 * studio and can never read City Ink's customers — not through the screens,
 * and not by calling the API by hand. Other studios get everything except an
 * inbox of their own, which arrives with a Runnit-owned Meta app.
 */

export type StudioRow = typeof studios.$inferSelect;

const DATA_STUDIO_KEY = "data_studio_id";

export async function getDataStudioId(): Promise<number | null> {
  const raw = await getSetting(DATA_STUDIO_KEY).catch(() => undefined);
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function setDataStudioId(id: number) {
  await setSetting(DATA_STUDIO_KEY, String(id));
}

export async function getStudio(id: number) {
  const db = await getDb();
  const rows = await db.select().from(studios).where(eq(studios.id, id)).limit(1);
  return rows[0];
}

export async function membershipsFor(userId: number) {
  const db = await getDb();
  return db
    .select({ studio: studios, role: studioMembers.role })
    .from(studioMembers)
    .innerJoin(studios, eq(studios.id, studioMembers.studioId))
    .where(eq(studioMembers.userId, userId))
    .orderBy(asc(studioMembers.createdAt), asc(studioMembers.id));
}

async function memberCount(studioId: number) {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(studioMembers)
    .where(eq(studioMembers.studioId, studioId));
  return Number(row?.n ?? 0);
}

async function roleIn(userId: number, studioId: number) {
  const db = await getDb();
  const rows = await db
    .select({ role: studioMembers.role })
    .from(studioMembers)
    .where(and(eq(studioMembers.userId, userId), eq(studioMembers.studioId, studioId)))
    .limit(1);
  return rows[0]?.role;
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/**
 * On a database that already has a studio's inbox in it (City Ink's), make
 * that studio a record of its own before anyone signs in, and make it the
 * data studio. It starts with no owner: the owner links it with the claim
 * code (see `claimDataStudio`). On a brand-new database this does nothing,
 * and the first studio anyone creates takes the connection instead.
 */
export async function ensureStudios(): Promise<void> {
  const db = await getDb();
  const [existing] = await db.select({ n: sql<number>`COUNT(*)` }).from(studios);
  if (Number(existing?.n ?? 0) > 0) {
    // A studio with an inbox and nobody able to claim it is a locked door.
    // Say so on every boot until it's fixed, in words that say how.
    const id = await getDataStudioId();
    if (id && (await memberCount(id)) === 0 && !claimCodes().length) {
      console.warn(
        "[Studios] The studio holding this app's inbox has no owner yet, and no code is set to claim it. " +
          "Set STUDIO_CLAIM_CODE in Railway, then create your account with it."
      );
    }
    return;
  }

  const [threads] = (await db.execute(
    sql`SELECT (SELECT COUNT(*) FROM messenger_conversations) AS threads,
               (SELECT COUNT(*) FROM facebook_config) AS configs`
  )) as unknown as [{ threads: number; configs: number }[]];
  const hasHistory = Number(threads?.[0]?.threads ?? 0) > 0 || Number(threads?.[0]?.configs ?? 0) > 0;
  if (!hasHistory) return;

  const config = await getFacebookConfig().catch(() => undefined);
  const name = config?.pageName?.trim() || "My studio";
  await db.insert(studios).values({ name, theme: "coffee" });
  const [created] = await db.select().from(studios).orderBy(asc(studios.id)).limit(1);
  if (created) {
    await setDataStudioId(created.id);
    console.log(`[Studios] "${name}" set up as studio ${created.id} and linked to this app's inbox — waiting for its owner to claim it`);
    if (!claimCodes().length) {
      console.warn(
        "[Studios] No code is set to claim it yet. Set STUDIO_CLAIM_CODE in Railway, then create your account with it."
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Claiming the studio that already has an inbox                       */
/* ------------------------------------------------------------------ */

/**
 * Whether anyone may create an account here.
 *
 * Off unless PUBLIC_SIGNUP is set. City Ink's deployment runs on the Meta app
 * whose review says it is a private tool for one studio and is not sold to
 * other businesses — a public "Create your studio" on that address would make
 * the statement untrue and put the approval at risk (CLAUDE.md, Meta App
 * Review). There, the only way in is the studio's own claim code. A Runnit
 * deployment with its own Meta app sets PUBLIC_SIGNUP=open.
 */
export function signupsOpen(): boolean {
  return /^(open|true|1|yes|on)$/i.test(process.env.PUBLIC_SIGNUP?.trim() ?? "");
}

/** Whether `code` is one of the codes that unlock the existing studio. */
export function isClaimCode(code: string | undefined | null): boolean {
  if (!code) return false;
  const given = Buffer.from(code.trim());
  return claimCodes().some((expected) => {
    const e = Buffer.from(expected);
    return e.length === given.length && crypto.timingSafeEqual(e, given);
  });
}

/** What unlocks the existing studio: the old dashboard password, or a code set for the purpose. */
function claimCodes(): string[] {
  return [process.env.STUDIO_CLAIM_CODE, process.env.DASHBOARD_PASSWORD]
    .map((v) => v?.trim())
    .filter((v): v is string => !!v);
}

/** The studio waiting to be claimed, if there is one and it can be. */
export async function claimableStudio(): Promise<StudioRow | null> {
  const id = await getDataStudioId();
  if (!id || !claimCodes().length) return null;
  if ((await memberCount(id)) > 0) return null;
  return (await getStudio(id)) ?? null;
}

export async function claimDataStudio(userId: number, code: string): Promise<StudioRow> {
  const studio = await claimableStudio();
  if (!studio) throw new AccountError("There's no existing studio waiting to be linked.", 404);
  if (!isClaimCode(code)) throw new AccountError("That code doesn't match. It's the password you used for the dashboard.", 401);

  const db = await getDb();
  await db.insert(studioMembers).values({ studioId: studio.id, userId, role: "owner" });
  await updateUser(userId, { currentStudioId: studio.id });
  console.log(`[Studios] User ${userId} claimed studio ${studio.id} ("${studio.name}")`);
  return studio;
}

/* ------------------------------------------------------------------ */
/* Studios                                                             */
/* ------------------------------------------------------------------ */

export const STUDIO_FIELDS = [
  "name",
  "location",
  "address",
  "phone",
  "email",
  "instagram",
  "website",
  "tagline",
] as const;
export type StudioFields = Partial<Record<(typeof STUDIO_FIELDS)[number], string | null>>;

function clean(fields: StudioFields) {
  const out: Record<string, string | null> = {};
  for (const key of STUDIO_FIELDS) {
    if (!(key in fields)) continue;
    const value = fields[key];
    out[key] = typeof value === "string" ? value.trim().slice(0, 255) || null : null;
  }
  if ("name" in out && !out.name) throw new AccountError("Your studio needs a name.");
  return out;
}

export async function createStudio(userId: number, fields: StudioFields & { name: string }) {
  const values = clean(fields);
  const db = await getDb();
  const [result] = (await db.insert(studios).values({
    name: values.name!,
    location: values.location ?? null,
    address: values.address ?? null,
    phone: values.phone ?? null,
    email: values.email ?? null,
    instagram: values.instagram ?? null,
    website: values.website ?? null,
    tagline: values.tagline ?? null,
    theme: "noir",
  })) as unknown as [{ insertId: number }];
  const id = Number(result?.insertId);
  if (!id) throw new Error("The studio was saved but its id didn't come back.");
  await db.insert(studioMembers).values({ studioId: id, userId, role: "owner" });
  await updateUser(userId, { currentStudioId: id });

  // A fresh deployment with no inbox yet: the first studio made here is the
  // one this app's Meta connection will belong to.
  if (!(await getDataStudioId())) await setDataStudioId(id);

  return (await getStudio(id))!;
}

async function requireOwner(userId: number, studioId: number) {
  const role = await roleIn(userId, studioId);
  if (role !== "owner") throw new AccountError("Only the studio's owner can change that.", 403);
}

export async function updateStudio(userId: number, studioId: number, fields: StudioFields) {
  await requireOwner(userId, studioId);
  const values = clean(fields);
  if (!Object.keys(values).length) return getStudio(studioId);
  const db = await getDb();
  await db.update(studios).set(values).where(eq(studios.id, studioId));
  return getStudio(studioId);
}

export const THEMES = ["coffee", "noir", "silver", "crimson", "blush", "sage", "midnight"] as const;
const HEX = /^#[0-9a-f]{6}$/i;

export async function setAppearance(
  userId: number,
  studioId: number,
  look: { theme?: string; mode?: "light" | "dark" | null; accent?: string | null }
) {
  await requireOwner(userId, studioId);
  const set: Partial<StudioRow> = {};
  if (look.theme !== undefined) {
    if (!(THEMES as readonly string[]).includes(look.theme)) throw new AccountError("That theme doesn't exist.");
    set.theme = look.theme;
  }
  if (look.mode !== undefined) set.mode = look.mode;
  if (look.accent !== undefined) {
    if (look.accent !== null && !HEX.test(look.accent)) throw new AccountError("Pick an accent colour from the list.");
    set.accent = look.accent;
  }
  if (!Object.keys(set).length) return getStudio(studioId);
  const db = await getDb();
  await db.update(studios).set(set).where(eq(studios.id, studioId));
  return getStudio(studioId);
}

export async function setStudioImage(
  userId: number,
  studioId: number,
  which: "logo" | "cover",
  assetId: string | null
) {
  await requireOwner(userId, studioId);
  if (assetId) await requireOwnAsset(userId, assetId);
  const db = await getDb();
  await db
    .update(studios)
    .set(which === "logo" ? { logoAssetId: assetId } : { coverAssetId: assetId })
    .where(eq(studios.id, studioId));
  return getStudio(studioId);
}

export async function switchStudio(userId: number, studioId: number) {
  if (!(await roleIn(userId, studioId))) throw new AccountError("You're not part of that studio.", 403);
  await updateUser(userId, { currentStudioId: studioId });
  return getStudio(studioId);
}

/**
 * Remove a studio. Never the one holding the inbox — that would orphan every
 * conversation in it — and never someone's last studio.
 */
export async function deleteStudio(userId: number, studioId: number) {
  await requireOwner(userId, studioId);
  if ((await getDataStudioId()) === studioId) {
    throw new AccountError("This studio holds your connected inbox, so it can't be removed.");
  }
  const mine = await membershipsFor(userId);
  if (mine.length <= 1) throw new AccountError("You need at least one studio.");
  const db = await getDb();
  await db.delete(studioMembers).where(eq(studioMembers.studioId, studioId));
  await db.delete(studios).where(eq(studios.id, studioId));
  const user = await getUser(userId);
  if (user?.currentStudioId === studioId) {
    const next = mine.find((m) => m.studio.id !== studioId);
    await updateUser(userId, { currentStudioId: next?.studio.id ?? null });
  }
}

/* ------------------------------------------------------------------ */
/* Branding images                                                     */
/* ------------------------------------------------------------------ */

const BRAND_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BRAND_BYTES = 10 * 1024 * 1024;
const PROFILES = {
  // A logo is small on screen and often transparent; PNG survives shrinking.
  logo: { maxDimension: 640, quality: 90 },
  avatar: { maxDimension: 480, quality: 85 },
  cover: { maxDimension: 2000, quality: 82 },
} as const;
export type BrandKind = keyof typeof PROFILES;

export function brandUrl(id: string | null | undefined) {
  return id ? `/api/brand/${id}` : null;
}

export async function saveBrandAsset(userId: number, kind: BrandKind, contentType: string, bytes: Buffer) {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (!PROFILES[kind]) throw new AccountError("Unknown image type.");
  if (!BRAND_TYPES.has(type)) {
    throw new AccountError("Use a JPG, PNG, WebP or GIF image.", 415);
  }
  if (!bytes.length) throw new AccountError("That image came through empty.");
  if (bytes.length > MAX_BRAND_BYTES) throw new AccountError("That image is over 10MB — try a smaller one.", 413);

  const shrunk = await shrinkPhoto(bytes, type, PROFILES[kind]);
  // If sharp couldn't read it, it isn't an image we can show.
  if (shrunk.original && /couldn't read|kept as it arrived —/.test(shrunk.detail) && type !== "image/gif") {
    throw new AccountError("That file couldn't be read as an image.", 415);
  }
  const id = crypto.randomBytes(20).toString("hex");
  const db = await getDb();
  await db.insert(brandAssets).values({
    id,
    userId,
    kind,
    contentType: shrunk.contentType,
    bytes: shrunk.bytes,
  });
  return { id, url: brandUrl(id)! };
}

export async function readBrandAsset(id: string) {
  const db = await getDb();
  const rows = await db.select().from(brandAssets).where(eq(brandAssets.id, id)).limit(1);
  return rows[0];
}

async function requireOwnAsset(userId: number, assetId: string) {
  const asset = await readBrandAsset(assetId);
  if (!asset || asset.userId !== userId) throw new AccountError("That image isn't one of yours.", 403);
}

export async function setAvatar(userId: number, assetId: string | null) {
  if (assetId) await requireOwnAsset(userId, assetId);
  await updateUser(userId, { avatarAssetId: assetId });
}

/* ------------------------------------------------------------------ */
/* The viewer                                                          */
/* ------------------------------------------------------------------ */

export interface Viewer {
  user: UserRow;
  studio: StudioRow | null;
  role: string | null;
  dataStudioId: number | null;
  /** May this request read and change the connected inbox, agent and settings? */
  canReadData: boolean;
}

/** Works out which studio a signed-in user is looking at, and what that lets them see. */
export async function viewerFor(user: UserRow): Promise<Viewer> {
  const mine = await membershipsFor(user.id);
  let current = mine.find((m) => m.studio.id === user.currentStudioId) ?? mine[0];
  if (current && current.studio.id !== user.currentStudioId) {
    await updateUser(user.id, { currentStudioId: current.studio.id }).catch(() => undefined);
  }
  const dataStudioId = await getDataStudioId();
  return {
    user,
    studio: current?.studio ?? null,
    role: current?.role ?? null,
    dataStudioId,
    canReadData: !!current && current.studio.id === dataStudioId,
  };
}

/** The shape the browser gets for "who am I and where am I". */
export async function describeViewer(viewer: Viewer | null, expired = false) {
  const waiting = await claimableStudio();
  const access = {
    signupsOpen: signupsOpen(),
    // Where "forgot your password" points until resets are emailed out.
    supportEmail: process.env.SUPPORT_EMAIL?.trim() || null,
    // Closed sign-up still lets the owner in once: with the studio's code.
    inviteOnly: !signupsOpen() && !!waiting,
  };
  if (!viewer) {
    return {
      user: null,
      expired,
      studios: [],
      currentStudioId: null,
      // The sign-up page says whose account it is making. Only the studio's
      // name — what is already on its sign — and only while it waits.
      claimable: access.inviteOnly && waiting ? { name: waiting.name } : null,
      ...access,
    };
  }
  const mine = await membershipsFor(viewer.user.id);
  const claimable = waiting;
  const u = viewer.user;
  return {
    user: {
      id: u.id,
      name: u.name ?? "",
      email: u.email ?? "",
      avatarUrl: brandUrl(u.avatarAssetId),
      avatarAssetId: u.avatarAssetId ?? null,
      onboardingStep: u.onboardingStep ?? "welcome",
      onboardingComplete: !!u.onboardingCompletedAt,
    },
    expired: false,
    studios: mine.map(({ studio, role }) => ({
      id: studio.id,
      name: studio.name,
      location: studio.location,
      address: studio.address,
      phone: studio.phone,
      email: studio.email,
      instagram: studio.instagram,
      website: studio.website,
      tagline: studio.tagline,
      logoUrl: brandUrl(studio.logoAssetId),
      logoAssetId: studio.logoAssetId,
      coverUrl: brandUrl(studio.coverAssetId),
      coverAssetId: studio.coverAssetId,
      theme: studio.theme ?? "noir",
      mode: (studio.mode as "light" | "dark" | null) ?? null,
      accent: studio.accent ?? null,
      role,
      connected: studio.id === viewer.dataStudioId,
    })),
    currentStudioId: viewer.studio?.id ?? null,
    claimable: claimable ? { name: claimable.name } : null,
    ...access,
  };
}

/** Everyone who has ever signed in owns at least the studio they made — used by tests. */
export async function countUsers() {
  const db = await getDb();
  const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(users);
  return Number(row?.n ?? 0);
}

/* ------------------------------------------------------------------ */
/* Who the agent speaks as                                             */
/* ------------------------------------------------------------------ */

export interface StudioIdentity {
  /** "City Ink Tattoo" */
  name: string;
  /** "Geelong" — the first part of the location, or "" */
  city: string;
  /** "City Ink Tattoo Geelong" / "Northside Ink in Fitzroy" — for sentences */
  label: string;
  /** The owner's first name, or "the studio owner" */
  owner: string;
}

let identityCache: { at: number; value: StudioIdentity } | null = null;

/**
 * The studio the agent writes for, and whose voice it writes in.
 *
 * The prompts used to say "City Ink Tattoo Geelong" and "Brad" in so many
 * words — right for one studio, wrong for every other. They come from the
 * connected studio's record and its owner now, so City Ink still reads as
 * City Ink and Brad, and any other studio reads as itself. Cached a minute;
 * it is asked on every draft.
 */
export async function studioIdentity(): Promise<StudioIdentity> {
  if (identityCache && Date.now() - identityCache.at < 60_000) return identityCache.value;
  let name = "";
  let location = "";
  let owner = "";
  try {
    const id = await getDataStudioId();
    const studio = id ? await getStudio(id) : undefined;
    name = studio?.name?.trim() ?? "";
    location = studio?.location?.trim() ?? "";
    if (id) {
      const db = await getDb();
      const rows = await db
        .select({ name: users.name })
        .from(studioMembers)
        .innerJoin(users, eq(users.id, studioMembers.userId))
        .where(and(eq(studioMembers.studioId, id), eq(studioMembers.role, "owner")))
        .orderBy(asc(studioMembers.id))
        .limit(1);
      owner = rows[0]?.name?.trim().split(/\s+/)[0] ?? "";
    }
    if (!name) name = (await getFacebookConfig().catch(() => undefined))?.pageName?.trim() ?? "";
  } catch {
    /* fall through to the defaults — a draft must never fail over a name */
  }
  name ||= "the studio";
  const city = location.split(",")[0]?.trim() ?? "";
  const label = city && !name.toLowerCase().includes(city.toLowerCase()) ? `${name} in ${city}` : name;
  const value = { name, city, label, owner: owner || "the studio owner" };
  identityCache = { at: Date.now(), value };
  return value;
}
