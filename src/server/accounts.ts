import crypto from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "./db.js";
import { sessions, users } from "../drizzle/schema.js";

/**
 * Accounts: who is signed in, and how they got there.
 *
 * This replaces the single shared password on the studio's door. That was
 * right for one studio with one owner; a product other studios sign up to
 * needs a person per login, a session per browser, and a way to tell which
 * studio a request is allowed to see (studios.ts).
 *
 * Passwords are scrypt, salted per user. Sessions are a random token in an
 * httpOnly cookie; the database only ever holds the token's SHA-256, so a
 * copy of the sessions table signs nobody in.
 */

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

export const SESSION_COOKIE = "runnit_session";
const SESSION_DAYS = 30;
// A session seen again after this long gets its expiry pushed out, so
// someone who opens the app every day is never signed out, and a laptop
// left alone for a month is.
const SLIDE_AFTER_MS = 12 * 60 * 60 * 1000;

export const MIN_PASSWORD = 8;

export type UserRow = typeof users.$inferSelect;

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** A hash to compare against when there's no such user, so a wrong email
 *  takes as long as a wrong password and the timing says nothing. */
let decoy: string | null = null;
async function decoyHash() {
  decoy ??= await hashPassword(crypto.randomBytes(12).toString("hex"));
  return decoy;
}

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

export function looksLikeEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

/* ------------------------------------------------------------------ */
/* Attempts                                                            */
/* ------------------------------------------------------------------ */

/**
 * Ten wrong tries in fifteen minutes per email, then a pause. Per network
 * address the limit is looser — a whole studio shares one wifi, and one
 * person fumbling their password must not lock the front desk out.
 * In memory on purpose: it resets on a deploy, which is fine for slowing a
 * guesser down, and it costs no table.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_TRIES = 10;
const MAX_TRIES_PER_ADDRESS = 40;
const tries = new Map<string, { count: number; since: number }>();

const limitFor = (key: string) =>
  /-ip:|^signup:|^claim:/.test(key) ? MAX_TRIES_PER_ADDRESS : MAX_TRIES;

export function tooManyAttempts(keys: string[]): boolean {
  const now = Date.now();
  return keys.some((key) => {
    const entry = tries.get(key);
    if (!entry || now - entry.since > WINDOW_MS) return false;
    return entry.count >= limitFor(key);
  });
}

export function noteAttempt(keys: string[]) {
  const now = Date.now();
  for (const key of keys) {
    const entry = tries.get(key);
    if (!entry || now - entry.since > WINDOW_MS) tries.set(key, { count: 1, since: now });
    else entry.count++;
  }
  // Keep the map from growing without bound on a long-lived process.
  if (tries.size > 5000) {
    for (const [key, entry] of tries) if (now - entry.since > WINDOW_MS) tries.delete(key);
  }
}

export function clearAttempts(keys: string[]) {
  for (const key of keys) tries.delete(key);
}

export function clientAddress(req: Request) {
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export async function findUserByEmail(email: string) {
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.email, normaliseEmail(email))).limit(1);
  return rows[0];
}

export async function getUser(id: number) {
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export class AccountError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export async function createUser(input: { name: string; email: string; password: string }) {
  const name = input.name.trim();
  const email = normaliseEmail(input.email);
  if (!name) throw new AccountError("What should we call you?");
  if (!looksLikeEmail(email)) throw new AccountError("That email doesn't look right.");
  if (input.password.length < MIN_PASSWORD) {
    throw new AccountError(`Use at least ${MIN_PASSWORD} characters for your password.`);
  }
  if (await findUserByEmail(email)) {
    throw new AccountError("There's already an account with that email. Log in instead.", 409);
  }

  const db = await getDb();
  try {
    await db.insert(users).values({
      openId: `local:${crypto.randomUUID()}`,
      name,
      email,
      loginMethod: "password",
      role: "user",
      passwordHash: await hashPassword(input.password),
      onboardingStep: "welcome",
      lastSignedIn: new Date(),
    });
  } catch (error) {
    // Two sign-ups racing each other: the unique index says who won.
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      throw new AccountError("There's already an account with that email. Log in instead.", 409);
    }
    throw error;
  }
  const created = await findUserByEmail(email);
  if (!created) throw new Error("The account was saved but couldn't be read back.");
  return created;
}

/** The user, when the email and password match; undefined otherwise. */
export async function checkCredentials(email: string, password: string) {
  const user = await findUserByEmail(email);
  const ok = await verifyPassword(password, user?.passwordHash ?? (await decoyHash()));
  return ok && user ? user : undefined;
}

export async function updateUser(
  id: number,
  fields: Partial<
    Pick<
      UserRow,
      "name" | "email" | "avatarAssetId" | "currentStudioId" | "onboardingStep" | "onboardingCompletedAt" | "passwordHash" | "lastSignedIn"
    >
  >
) {
  const db = await getDb();
  await db.update(users).set(fields).where(eq(users.id, id));
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

const digest = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function sessionToken(req: Request) {
  return readCookie(req.headers.cookie, SESSION_COOKIE);
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export async function startSession(req: Request, res: Response, userId: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const db = await getDb();
  await db.insert(sessions).values({
    id: digest(token),
    userId,
    expiresAt,
    userAgent: String(req.headers["user-agent"] ?? "").slice(0, 255) || null,
  });
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 });
  await updateUser(userId, { lastSignedIn: new Date() });
  // Tidy as we go: expired sessions are no use to anyone.
  void db.delete(sessions).where(lt(sessions.expiresAt, new Date())).catch(() => undefined);
}

export async function endSession(req: Request, res: Response) {
  const token = sessionToken(req);
  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, digest(token))).catch(() => undefined);
  }
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** Signs out every other browser — used when the password changes. */
export async function endOtherSessions(userId: number, keepToken?: string) {
  const db = await getDb();
  const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
  const keep = keepToken ? digest(keepToken) : null;
  for (const row of rows) {
    if (row.id !== keep) await db.delete(sessions).where(eq(sessions.id, row.id));
  }
}

/**
 * The signed-in user for this request, or why there isn't one.
 *
 * `expired` is true when the browser sent a session we no longer honour —
 * so the sign-in page can say "you were signed out" rather than looking as
 * though the app forgot who you are.
 */
export async function userFromRequest(
  req: Request,
  res?: Response
): Promise<{ user: UserRow | null; expired: boolean }> {
  const token = sessionToken(req);
  if (!token) return { user: null, expired: false };

  const db = await getDb();
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, digest(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const session = rows[0];
  if (!session) {
    res?.clearCookie(SESSION_COOKIE, cookieOptions());
    return { user: null, expired: true };
  }

  const user = await getUser(session.userId);
  if (!user) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    res?.clearCookie(SESSION_COOKIE, cookieOptions());
    return { user: null, expired: true };
  }

  const seen = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
  if (Date.now() - seen > SLIDE_AFTER_MS) {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt })
      .where(eq(sessions.id, session.id))
      .catch(() => undefined);
    res?.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 });
  }
  return { user, expired: false };
}
