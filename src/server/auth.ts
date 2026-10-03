import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { userFromRequest } from "./accounts.js";
import { viewerFor } from "./studios.js";

/**
 * Who may read the studio's own data.
 *
 * This was a single shared password on the door (DASHBOARD_PASSWORD). It is
 * accounts now — accounts.ts signs people in, studios.ts decides what their
 * open studio lets them see — and the rule for everything in here is one
 * line: `viewer.canReadData`. A member of the studio the inbox belongs to,
 * with that studio open. Anyone else, including a stranger who has just
 * signed up for their own studio, gets a 401.
 *
 * DASHBOARD_PASSWORD still matters once: it is the code that links the
 * existing studio to its owner's new account (studios.ts, claimDataStudio).
 */

async function canReadData(req: Request): Promise<boolean> {
  try {
    const { user } = await userFromRequest(req);
    if (!user) return false;
    return (await viewerFor(user)).canReadData;
  } catch {
    return false;
  }
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
  // Any stable secret will do, as long as it isn't public.
  const seed =
    process.env.ASSET_SIGNING_SECRET ||
    process.env.DASHBOARD_PASSWORD ||
    process.env.LLM_API_KEY ||
    process.env.VERIFY_TOKEN ||
    "city-ink-assets";
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
  if (assetSignatureValid(req)) return next();
  void canReadData(req).then((ok) =>
    ok ? next() : void res.status(401).json({ error: "Sign in first." })
  );
}

/**
 * Guards the studio's own data. Not applied to the webhook (Meta has to
 * reach it), to the artists' upload POST (they scan a QR code on the wall
 * and a login there guarantees it never gets used), or to the page shell
 * itself, which is just an empty app until the API answers.
 */
export function requireStudio(req: Request, res: Response, next: NextFunction): void {
  void canReadData(req).then((ok) =>
    ok ? next() : void res.status(401).json({ error: "Sign in first." })
  );
}
