import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * A password on the studio's own door.
 *
 * Everything in here — every customer's name, what they said, the photos
 * they sent, the phone numbers they gave for a booking — was readable by
 * anyone who had the address. That was an oversight, not a decision.
 *
 * It is deliberately off until DASHBOARD_PASSWORD is set, for one reason:
 * Meta's reviewers are looking at the live app right now, with instructions
 * that say no sign-in is needed. A login appearing underneath them mid-review
 * is a rejection. Setting the variable in Railway turns it on the moment
 * that's finished, with nothing to deploy.
 */
const COOKIE = "cityink_studio";
const DAYS = 14;

function password(): string | undefined {
  const value = process.env.DASHBOARD_PASSWORD?.trim();
  return value ? value : undefined;
}

export function loginRequired(): boolean {
  return !!password();
}

/**
 * The signing key is derived from the password rather than configured
 * separately — one thing to set, and changing the password invalidates every
 * session that was issued under the old one, which is what anyone changing a
 * password expects to happen.
 */
function signingKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(`cityink-session:${secret}`).digest();
}

function sign(expiresAt: number, secret: string): string {
  const mac = crypto
    .createHmac("sha256", signingKey(secret))
    .update(String(expiresAt))
    .digest("hex");
  return `${expiresAt}.${mac}`;
}

function valid(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const [rawExpiry, mac] = token.split(".");
  if (!rawExpiry || !mac) return false;

  const expiresAt = Number(rawExpiry);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = crypto
    .createHmac("sha256", signingKey(secret))
    .update(rawExpiry)
    .digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so check that first.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * A link Facebook can fetch once, without a session.
 *
 * Publishing a post with a photo works by handing Facebook a URL and letting
 * its servers come and get the picture. Facebook has no cookie, so the moment
 * a password is set every scheduled post with an image would fail with a 401
 * — silently, from Brad's point of view, because the failure happens on
 * Facebook's side of the fetch.
 *
 * Opening the route isn't the answer: it serves customers' reference photos
 * too. So the publisher signs the one path it's about to hand over, the
 * signature expires, and nothing else is reachable with it.
 */
const ASSET_WINDOW_MS = 60 * 60 * 1000;

function assetKey(): Buffer {
  // Any stable secret will do. When no password is set the route is open
  // anyway, so this only has to be strong once there is one.
  const seed = password() || process.env.VERIFY_TOKEN || "city-ink-assets";
  return crypto.createHash("sha256").update(`cityink-asset:${seed}`).digest();
}

export function signAssetPath(path: string): string {
  const expiresAt = Date.now() + ASSET_WINDOW_MS;
  const mac = crypto
    .createHmac("sha256", assetKey())
    .update(`${path}:${expiresAt}`)
    .digest("hex")
    .slice(0, 32);
  return `${path}${path.includes("?") ? "&" : "?"}e=${expiresAt}&s=${mac}`;
}

function assetSignatureValid(req: Request): boolean {
  const expiresAt = Number(req.query.e);
  const given = String(req.query.s ?? "");
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !given) return false;

  const expected = crypto
    .createHmac("sha256", assetKey())
    .update(`${req.path}:${expiresAt}`)
    .digest("hex")
    .slice(0, 32);
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The studio's session, or a link the studio itself signed for one fetch.
 * Used only where something outside has to come and collect a file.
 */
export function requireStudioOrSignedLink(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (signedIn(req) || assetSignatureValid(req)) return next();
  res.status(401).json({ error: "Sign in first." });
}

/** Cookies without pulling in a parser for one header. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

export function signedIn(req: Request): boolean {
  const secret = password();
  if (!secret) return true; // No password set — nothing to be signed in to.
  return valid(readCookie(req.headers.cookie, COOKIE), secret);
}

/**
 * Guards the studio's own data. Not applied to the webhook (Meta has to
 * reach it), to the artists' upload POST (they scan a QR code on the wall
 * and a login there guarantees it never gets used), or to the page shell
 * itself, which is just an empty app until the API answers.
 */
export function requireStudio(req: Request, res: Response, next: NextFunction): void {
  if (signedIn(req)) return next();
  res.status(401).json({ error: "Sign in first." });
}

export function mountAuth(app: {
  post: (path: string, handler: (req: Request, res: Response) => void) => void;
  get: (path: string, handler: (req: Request, res: Response) => void) => void;
}): void {
  // So the browser knows whether to show the app or the password box, without
  // having to provoke a 401 first.
  app.get("/api/session", (req, res) => {
    res.json({ required: loginRequired(), signedIn: signedIn(req) });
  });

  app.post("/api/login", (req, res) => {
    const secret = password();
    if (!secret) return res.json({ ok: true });

    const given = String((req.body as { password?: unknown })?.password ?? "");
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      // Same wording and no timing tell about which part was wrong.
      return res.status(401).json({ ok: false, error: "That's not the password." });
    }

    const expiresAt = Date.now() + DAYS * 24 * 60 * 60 * 1000;
    res.cookie?.(COOKIE, sign(expiresAt, secret), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: DAYS * 24 * 60 * 60 * 1000,
      path: "/",
    });
    res.json({ ok: true });
  });

  app.post("/api/logout", (_req, res) => {
    res.clearCookie?.(COOKIE, { path: "/" });
    res.json({ ok: true });
  });
}
