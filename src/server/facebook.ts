import crypto from "node:crypto";
import axios from "axios";
import { signAssetPath } from "./auth.js";
import { cacheAttachments } from "./attachments.js";
import {
  getFacebookConfig,
  getConversationsMissingNamesWithPlatform,
  setConversationName,
  setConversationAvatar,
  updatePageIdentity,
  realName,
} from "./db.js";

// Overridable so the whole thing can be run end to end against a stand-in
// Graph API. Unset everywhere except a test run, which is the only way to
// watch a real page render a real name without messaging the studio.
const GRAPH = process.env.FACEBOOK_GRAPH_URL || "https://graph.facebook.com/v21.0";

// Meta's newer Instagram flow answers on its own host, not graph.facebook.com.
// Falls back to the Facebook override first so one stand-in server can serve
// both platforms in a test run.
const IG_GRAPH =
  process.env.INSTAGRAM_GRAPH_URL ||
  process.env.FACEBOOK_GRAPH_URL ||
  "https://graph.instagram.com/v21.0";

/**
 * Instagram's conversations edge refuses a page it considers too big, with
 * an HTTP 500 and "Please reduce the amount of data you're asking for" — and
 * how big is too big is not a fixed number. Eight threads was already a
 * reduction from twenty-five and it still refuses on this studio's inbox.
 *
 * So stop guessing a number and let Instagram pick it: ask, and on that one
 * error halve the page and ask again, down to a single thread. A studio's
 * inbox is small; four extra round trips is nothing next to Instagram
 * silently returning nothing, which is what happened instead.
 *
 * Only that error is retried. A 403 over a missing permission would come
 * back identically no matter how small the page is.
 */
function asksForTooMuch(error: unknown): boolean {
  const err = (error as {
    response?: { data?: { error?: { message?: string; error_subcode?: number; error_user_msg?: string } } };
  })?.response?.data?.error;
  if (!err) return false;
  // Meta says the same thing two ways, and the second one is the one the
  // studio's own inbox actually returns:
  //   "Please reduce the amount of data you're asking for"
  //   "Your query has timed out since you have too many conversations"  (2534084)
  // Only the first was recognised, so the retry never engaged on the error
  // that was firing every three minutes.
  return (
    err.error_subcode === 2534084 ||
    /reduce the amount of data/i.test(err.message ?? "") ||
    /too many conversations/i.test(err.error_user_msg ?? "")
  );
}

/**
 * When an inbox refused us, and for how long to leave it alone.
 *
 * Instagram's conversations edge refuses this studio's inbox outright —
 * "you have too many conversations" — however small the page. Retrying that
 * every three minutes achieved nothing except a Graph connection held open
 * for forty seconds out of every hundred and eighty, and a log nobody could
 * read past. The webhook is the live path for Instagram and it works; this
 * is the floor under it, and a floor can afford to be patient.
 */
const inboxBackoff = new Map<string, { until: number; failures: number }>();

function inboxIsResting(key: string): boolean {
  const state = inboxBackoff.get(key);
  return !!state && Date.now() < state.until;
}

function noteInboxFailure(key: string): void {
  const failures = (inboxBackoff.get(key)?.failures ?? 0) + 1;
  // 3 minutes, then 6, 12, 24, capped at half an hour.
  const minutes = Math.min(30, 3 * 2 ** Math.min(failures - 1, 4));
  inboxBackoff.set(key, { until: Date.now() + minutes * 60_000, failures });
  if (failures === 1 || failures % 5 === 0) {
    console.warn(`[Facebook] Leaving the ${key} inbox alone for ${minutes} minutes after ${failures} refusal(s)`);
  }
}

function noteInboxSuccess(key: string): void {
  inboxBackoff.delete(key);
}

async function getShrinking<T>(
  // Which inbox is being asked, because the log line used to say "Instagram
  // refused that page" whichever inbox it was — and the numbers in it
  // (12, from a page of fifty) could only have come from Messenger. Reading
  // a log and being told the wrong inbox is how three days went into the
  // wrong permission once already.
  who: string,
  url: string,
  params: Record<string, string> | undefined,
  timeout: number
): Promise<{ data: T }> {
  const start = Number(params?.limit ?? 0);
  let attempt = 0;
  let limit = start;
  // The whole retry chain has to finish inside the caller's slot. The poll
  // runs every three minutes, and four retries of a forty-second timeout
  // takes longer than that — the polls began overlapping, each one holding a
  // Graph connection open while the next started.
  const deadline = Date.now() + 90_000;

  for (;;) {
    try {
      return await axios.get<T>(url, { params, timeout });
    } catch (error) {
      // Nothing to shrink on a paging URL, which carries its own limit.
      if (!params || !start || !asksForTooMuch(error) || limit <= 1 || attempt >= 3) throw error;
      if (Date.now() > deadline) {
        console.warn("[Facebook] Gave up shrinking — out of time before the next poll");
        throw error;
      }
      attempt += 1;
      // Straight to a quarter rather than a half. Meta has refused every
      // gentle step so far, and each refusal costs a full timeout.
      limit = Math.max(1, Math.floor(limit / 4));
      params = { ...params, limit: String(limit) };
      console.warn(`[Facebook] ${who} refused that page — asking for ${limit} instead`);
    }
  }
}


export type Platform = "facebook" | "instagram";

/**
 * Which host and which token to use for a given inbox.
 *
 * There are two ways to reach Instagram and they are not interchangeable. A
 * Page token carrying the Instagram permissions talks to graph.facebook.com
 * exactly like Messenger does; a token from Meta's Instagram-login flow talks
 * to graph.instagram.com and a Page endpoint will refuse it. Which one Brad
 * ends up holding depends on which product Meta walked him through, so rather
 * than guess: use the Instagram token against the Instagram host when one has
 * been saved, and otherwise carry on with the Page token, which is what has
 * been working all along.
 *
 * Messenger never takes the Instagram path, so an Instagram token can't take
 * down the inbox that already works.
 */
async function endpointFor(
  platform: Platform
): Promise<{ base: string; token: string } | null> {
  const config = await getFacebookConfig().catch(() => undefined);
  if (!config) return null;

  if (platform === "instagram" && config.instagramAccessToken) {
    // Which host depends on where the token came from, not on which box it
    // was typed into. Meta's own Instagram-settings page hands out a PAGE
    // token, and pasting that here used to send every Instagram call to
    // graph.instagram.com, which refuses Page tokens outright — Instagram
    // would go quiet with nothing to show for it. Worked out at save time and
    // stored; the old default stands for tokens saved before that existed.
    const base = config.instagramTokenHost === "facebook" ? GRAPH : IG_GRAPH;
    return { base, token: config.instagramAccessToken };
  }
  if (!config.pageAccessToken) return null;
  return { base: GRAPH, token: config.pageAccessToken };
}

/**
 * This app's own address on the internet, for the times something outside
 * has to come and fetch a file from us — publishing a post with a photo
 * that was uploaded here rather than linked from elsewhere.
 *
 * Railway sets RAILWAY_PUBLIC_DOMAIN for us; PUBLIC_URL overrides it for
 * anywhere else. Returns undefined rather than guessing, so a missing
 * setting fails with a sentence instead of a broken image.
 */
export function publicUrl(path: string): string | undefined {
  if (/^https?:\/\//.test(path)) return path;

  const origin =
    process.env.PUBLIC_URL?.replace(/\/$/, "") ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "");
  if (!origin) return undefined;

  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`;
}

/**
 * BUG FIX #1 — the original hashed JSON.stringify(req.body), which is a
 * re-serialisation, not the bytes Facebook signed. Key order and whitespace
 * drift, so the check failed at random. This takes the raw Buffer.
 *
 * BUG FIX #2 — timingSafeEqual throws on length mismatch, so a malformed
 * header crashed the request instead of rejecting it. Length is checked first.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string
): boolean {
  if (!signature || !appSecret || !rawBody?.length) return false;

  const hash = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const expected = `sha256=${hash}`;

  const received = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (received.length !== computed.length) return false;

  return crypto.timingSafeEqual(received, computed);
}

/** Meta refusing because its 24-hour reply window has closed. */
function outsideWindow(error: unknown): boolean {
  const err = (error as { response?: { data?: { error?: { code?: number; error_subcode?: number; message?: string } } } })
    ?.response?.data?.error;
  if (!err) return false;
  return (
    err.error_subcode === 2018278 ||
    /outside of allowed window|outside the allowed window|24[- ]hour/i.test(err.message ?? "")
  );
}

/**
 * A Graph refusal to send, said in a sentence the studio can act on.
 *
 * This one matters more than the others: a failure here means a customer
 * asked something and got nothing back, and the studio believed otherwise.
 */
export function explainSendFailure(raw: string, platform: Platform = "facebook"): string {
  if (/outside of allowed window|outside the allowed window|2018278/i.test(raw)) {
    return (
      "Meta wouldn't deliver this: it's been more than 7 days since they last messaged, " +
      "which is as long as Meta lets a business reply. Answer them from the Messenger or " +
      "Instagram app instead — the draft is still here to copy."
    );
  }
  if (/Session has expired|access token/i.test(raw)) {
    return (
      "The Facebook token has expired, so nothing can be sent. Paste a fresh one in " +
      "Settings → Facebook Page and this reply will go through — nothing was lost."
    );
  }
  // Brad, correcting this after it had been on the card for days:
  //
  //   "it's not only users with admin access I can reply to, the reply
  //    actually sends to anyone that has messaged in from messenger just not
  //    instagram"
  //
  // He is right, and the old wording here was wrong in a way that mattered.
  // It said the app "can only message people with a role on the app", which
  // reads as nothing reaching any customer on either inbox — and that sent
  // days into the wrong question. Messenger works: Standard Access lets a
  // Page reply to anyone who messaged it first. Instagram is the one that is
  // blocked, and it is blocked on one named permission.
  //
  // So say which inbox, and say the other one is fine.
  const blocked = /does not have role on app|role on the app/i.test(raw) ||
    /pages_messaging|instagram_business_manage_messages|instagram_manage_messages|Advanced Access/i.test(raw);
  if (blocked) {
    if (platform === "instagram") {
      return (
        "Instagram replies are blocked — Meta hasn't granted this app Advanced Access to " +
        "instagram_manage_messages yet, and Instagram is the only inbox that needs it. " +
        "Messenger replies still send normally. Answer this one from the Instagram app for " +
        "now; the draft is here to copy."
      );
    }
    return (
      "Meta refused this send on a permission. Messenger replies normally go through to " +
      "anyone who has messaged the Page, so this is worth reading in full: " +
      `${raw.slice(0, 200)}`
    );
  }
  if (/does not exist|Unsupported (get|post) request/i.test(raw)) {
    return "Meta doesn't recognise that conversation any more — the person may have deleted it or blocked the Page.";
  }
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
}

/**
 * Send a reply, and be certain it actually went.
 *
 * Two things here are load-bearing:
 *
 * The HUMAN_AGENT retry. Meta's standard window closes 24 hours after the
 * customer's last message, and a tattoo studio replying to a three-day-old
 * enquiry is the normal case, not the edge case. Every reply this app sends
 * has been read and approved by a person, which is exactly what the Human
 * Agent tag is for, and it widens the window to seven days. Without it,
 * approving an older draft failed — and used to fail silently.
 *
 * And the message_id check. Graph can answer 200 without having sent
 * anything; treating that as success is how a reply goes missing with
 * nothing anywhere to say so.
 */
export async function sendMessengerMessage(
  recipientId: string,
  messageText: string,
  platform: Platform = "facebook"
): Promise<void> {
  const endpoint = await endpointFor(platform);
  if (!endpoint) throw new Error("Facebook is not connected yet");

  const post = (body: Record<string, unknown>) =>
    axios.post(`${endpoint.base}/me/messages`, body, {
      params: { access_token: endpoint.token },
      timeout: 15000,
    });

  const message = { text: messageText };
  let data: { message_id?: string; error?: { message?: string } };

  try {
    ({ data } = await post({
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message,
    }));
  } catch (error) {
    if (!outsideWindow(error)) {
      // Graph's own words, always, next to the sentence built from them.
      // Logging only the explanation is exactly how three days went on the
      // wrong permission once already: the guess was all anyone could see.
      const raw = describeGraphError("send", error);
      console.error(`[Facebook] Send to ${recipientId} (${platform}) refused — ${raw}`);
      throw new Error(explainSendFailure(raw, platform));
    }
    // A person read this and approved it, so the Human Agent tag is the
    // honest description of what is happening as well as the one that works.
    try {
      ({ data } = await post({
        recipient: { id: recipientId },
        messaging_type: "MESSAGE_TAG",
        tag: "HUMAN_AGENT",
        message,
      }));
      console.log(`[Facebook] Sent to ${recipientId} under the Human Agent tag — the standard window had closed`);
    } catch (retryError) {
      const raw = describeGraphError("send", retryError);
      console.error(
        `[Facebook] Send to ${recipientId} (${platform}) refused under the Human Agent tag too — ${raw}`
      );
      throw new Error(explainSendFailure(raw, platform));
    }
  }

  if (!data?.message_id) {
    throw new Error(
      explainSendFailure(
        data?.error?.message ??
          "Meta accepted the request but didn't confirm the message was sent, so it may not have arrived.",
        platform
      )
    );
  }
}

export async function sendTypingIndicator(
  recipientId: string,
  platform: Platform = "facebook"
): Promise<void> {
  const endpoint = await endpointFor(platform);
  if (!endpoint) return;
  try {
    await axios.post(
      `${endpoint.base}/me/messages`,
      { recipient: { id: recipientId }, sender_action: "typing_on" },
      { params: { access_token: endpoint.token }, timeout: 8000 }
    );
  } catch {
    /* cosmetic only — never block a reply on this */
  }
}

/**
 * Why the last name lookup failed, in a sentence someone can act on.
 *
 * A raw Graph dump on the settings page reads as a broken app. The common
 * case here isn't a fault at all: Facebook simply won't release some
 * people's names to a Page — a restricted or deactivated account, or one
 * that has never interacted with the Page in a way that grants it. Nothing
 * about that is fixable from here, and saying so is kinder than an object
 * ID and a stack of permissions language.
 */
export function explainProfileFailure(detail: string): string {
  // Instagram names have their own answer, and it isn't the Facebook one.
  // Meta will not name an Instagram customer to an app without Advanced
  // Access to instagram_manage_messages — which is granted by App Review, not
  // by anything on this screen. The messages themselves arrive regardless.
  if (/Advanced Access to instagram_manage_messages|instagram_manage_messages permission/i.test(detail)) {
    return "Instagram won't tell the app who these customers are until Meta grants Advanced Access to instagram_manage_messages, which is part of the App Review already submitted. Their messages arrive and can be replied to as normal — only the name is missing, and it fills itself in once approval lands.";
  }
  if (/does not have the capability|\(#3\)/i.test(detail)) {
    return "Facebook won't give this app people's names one at a time — it never has. Names come from the Page inbox instead, which is why almost everyone is named. The few that aren't are people Facebook won't name to a Page at all.";
  }
  if (/does not exist|cannot be loaded|missing permissions|Unsupported get request/i.test(detail)) {
    return "Facebook won't release these customers' names. That happens with restricted or deactivated accounts, and it isn't something the app can fix — everyone else is named from the Page inbox as normal.";
  }
  // Meta will not name an Instagram customer without the person's consent,
  // and there is no consent flow for a business inbox. Permanent, and
  // nothing to do with the token.
  if (/\(#230\)|User consent is required/i.test(detail)) {
    return "Instagram won't release this person's name without their consent, and there is no way for a business to ask for it. Their messages arrive and can be replied to as normal; only the name is missing.";
  }
  // The account is gone, or was never an Instagram professional account.
  if (/\(#9010\)|No matching Instagram user/i.test(detail)) {
    return "Instagram has no account matching this thread any more — usually someone who deleted or deactivated. Nothing to fix; their old messages are still here.";
  }
  /*
   * An expired token says so in those words, or carries code 190.
   *
   * This used to match a bare "OAuthException", which is the error CLASS on
   * very nearly every Graph failure — including the two consent refusals
   * above. So a perfectly good token was reported as expired on every boot,
   * four seconds after the same log printed
   * "Page token belongs to app 4457207527757824". Acting on that means an
   * evening spent regenerating a token that was never the problem, which is
   * the exact wrong turn this file warns about for the model name and for
   * Graph permissions. Match the thing, not the family it belongs to.
   */
  if (/Session has expired|Error validating access token|session has been invalidated|code.{0,4}190/i.test(detail)) {
    return "The saved Page token has expired. Generate a new one in the Meta app dashboard and paste it in below.";
  }
  if (/rate limit|too many calls/i.test(detail)) {
    return "Facebook is rate-limiting the lookups. Leave it a few minutes and press the button again.";
  }
  return detail;
}

/**
 * Why the last name lookup failed. Sending someone to hunt through hosting
 * logs for this was a poor answer — the dashboard can just say it.
 */
let lastProfileError: { message: string; at: string } | null = null;
export function getLastProfileError() {
  return lastProfileError;
}

/**
 * When Meta has told us a whole platform's profile lookups are off limits.
 *
 * Instagram answers every one of these with "(#200) App does not have
 * Advanced Access to instagram_manage_messages" — for every person, for
 * every field combination, three calls each. With a dozen unnamed threads
 * that is three dozen guaranteed failures every couple of minutes, and a log
 * so full of red that the real faults in it were unreadable.
 *
 * Nothing about that is fixable from here; it is granted by App Review. So
 * ask once, believe the answer for an hour, and let it recover on its own
 * when approval lands.
 */
const profileLookupBlocked = new Map<Platform, { until: number; why: string }>();

function profileRefusalIsPermanent(detail: string): boolean {
  return /Advanced Access|does not have the capability|\(#3\)/i.test(detail);
}

export async function getSenderProfile(
  senderId: string,
  platform: Platform = "facebook"
): Promise<{ name?: string } | null> {
  const endpoint = await endpointFor(platform);
  if (!endpoint) return null;

  const blocked = profileLookupBlocked.get(platform);
  if (blocked && Date.now() < blocked.until) return null;

  // Facebook is inconsistent about which name fields a Page token may read,
  // and it varies with how the app was reviewed. Try the split fields, then
  // the combined one, before concluding there's no name to be had.
  // Instagram has no first/last name — it has a username, which is what the
  // studio would recognise anyway.
  const attempts =
    platform === "instagram"
      ? ["name,username", "username", "name"]
      : ["first_name,last_name", "name"];
  let lastDetail = "";

  for (const fields of attempts) {
    try {
      const { data } = await axios.get(`${endpoint.base}/${senderId}`, {
        params: { fields, access_token: endpoint.token },
        timeout: 8000,
      });
      const name = realName(
        [data.first_name, data.last_name].filter(Boolean).join(" ") ||
          data.name ||
          (data.username ? `@${data.username}` : "")
      );
      if (name) {
        lastProfileError = null;
        return { name };
      }
      lastDetail = `${fields}: reachable but returned no name`;
    } catch (error) {
      const err = error as { response?: { status?: number; data?: unknown } };
      lastDetail = err.response
        ? `${fields} → HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`
        : `${fields} → ${(error as Error).message}`;
    }
  }

  lastProfileError = { message: lastDetail, at: new Date().toISOString() };

  // A refusal that names a permission is about the app, not this person, so
  // asking again for the next eleven people will get the same answer.
  if (profileRefusalIsPermanent(lastDetail)) {
    // Trust the error over the caller. A refusal naming an Instagram
    // permission belongs to Instagram however it was asked for — recording
    // it against Facebook would silence Messenger's lookups, which work.
    const blame: Platform = /instagram/i.test(lastDetail) ? "instagram" : platform;
    const first = !profileLookupBlocked.has(blame);
    profileLookupBlocked.set(blame, { until: Date.now() + 60 * 60 * 1000, why: lastDetail });
    if (first) {
      console.warn(
        `[Facebook] ${blame} won't name anyone to this app yet — not asking again for an hour. ${lastDetail}`
      );
    }
    return null;
  }

  console.error(`[Facebook] No name for ${senderId} — ${lastDetail}`);
  return null;
}

/**
 * Whether the Page is actually handing its messages to this app.
 *
 * Verifying the webhook URL in the Meta dashboard is only half of it. The
 * Page itself has to be subscribed to the app, and until it is, Facebook
 * delivers nothing at all — no error, no retry, no clue. Which is exactly
 * what the hosting logs showed: not one POST from Facebook, ever.
 */
export const MESSENGER_FIELDS = [
  "messages",
  "messaging_postbacks",
  "message_echoes",
  "messaging_optins",
] as const;

export async function getMessengerSubscription(): Promise<{
  subscribed: boolean;
  /** True when Facebook wouldn't answer, so "not subscribed" isn't known. */
  unknown: boolean;
  fields: string[];
  missing: string[];
  detail: string;
}> {
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) {
    return {
      subscribed: false,
      unknown: true,
      fields: [],
      missing: [],
      detail: "Facebook isn't connected yet.",
    };
  }

  try {
    const { data } = await axios.get(`${GRAPH}/me/subscribed_apps`, {
      params: { access_token: config.pageAccessToken },
      timeout: 10000,
    });

    const apps: { subscribed_fields?: string[] }[] = data?.data ?? [];
    if (apps.length === 0) {
      return {
        subscribed: false,
        unknown: false,
        fields: [],
        missing: [...MESSENGER_FIELDS],
        detail: "This Page is NOT subscribed to the app, so Facebook sends it nothing.",
      };
    }

    const fields = apps.flatMap((app) => app.subscribed_fields ?? []);
    const missing = MESSENGER_FIELDS.filter((f) => !fields.includes(f));
    return {
      subscribed: true,
      unknown: false,
      fields,
      missing,
      detail: missing.length
        ? `Subscribed, but not for: ${missing.join(", ")}.`
        : "Subscribed, and receiving every message event.",
    };
  } catch (error) {
    // Not knowing is not the same as no. Reporting a failed check as "not
    // subscribed" sent someone hunting a subscription problem that didn't
    // exist, when the real answer was that the token had expired overnight.
    const err = error as { response?: { status?: number; data?: unknown } };
    const raw = JSON.stringify(err.response?.data ?? "");
    const expired = /Session has expired|Error validating access token|code":190/i.test(raw);
    return {
      subscribed: false,
      unknown: true,
      fields: [],
      missing: [],
      detail: expired
        ? "Couldn't check — the saved Page token has expired, so Facebook won't answer " +
          "anything. Paste a fresh one into the Page access token box below and this comes " +
          "back on its own. The subscription itself is almost certainly still fine."
        : `Couldn't check — Facebook wouldn't answer${
            err.response ? ` (HTTP ${err.response.status})` : ""
          }. This says nothing about whether the Page is subscribed.`,
    };
  }
}

/** Subscribe the Page to this app so message events start arriving. */
export async function subscribePageToApp(): Promise<{ ok: boolean; detail: string }> {
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) {
    return { ok: false, detail: "Connect the Facebook Page first." };
  }

  try {
    await axios.post(
      `${GRAPH}/me/subscribed_apps`,
      {},
      {
        params: {
          subscribed_fields: MESSENGER_FIELDS.join(","),
          access_token: config.pageAccessToken,
        },
        timeout: 12000,
      }
    );

    // Don't take the POST's word for it — read it back.
    const after = await getMessengerSubscription();
    return {
      ok: after.subscribed && after.missing.length === 0,
      detail: after.detail,
    };
  } catch (error) {
    const err = error as { response?: { status?: number; data?: unknown } };
    return {
      ok: false,
      detail: err.response
        ? `Facebook refused — HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 260)}`
        : `Facebook refused — ${(error as Error).message}`,
    };
  }
}

/**
 * Put the subscription back if it has lapsed.
 *
 * This is what actually broke the studio's inbox. The service was down for
 * about 25 hours; Facebook kept posting webhooks into a dead host, got
 * nothing back, and eventually dropped the Page's subscription — which is
 * documented behaviour after sustained delivery failures. Paying the bill
 * brought the app back but not the subscription, so the app looked healthy
 * and silently received nothing.
 *
 * Nobody should have to know that. On boot, and periodically after, the app
 * checks whether it is still subscribed and re-subscribes if it isn't. The
 * call is idempotent, so when everything is fine this is one cheap read.
 */
export async function ensureMessengerSubscription(): Promise<{
  action: "none" | "resubscribed" | "failed" | "skipped";
  detail: string;
}> {
  const config = await getFacebookConfig().catch(() => undefined);
  if (!config?.pageAccessToken) {
    return { action: "skipped", detail: "Facebook isn't connected yet." };
  }

  const current = await getMessengerSubscription();
  if (current.subscribed && current.missing.length === 0) {
    return { action: "none", detail: current.detail };
  }

  console.warn(`[Facebook] Messenger subscription has lapsed — ${current.detail}`);
  const repaired = await subscribePageToApp();
  return repaired.ok
    ? { action: "resubscribed", detail: repaired.detail }
    : { action: "failed", detail: repaired.detail };
}

/**
 * Names for everyone in the Page's inbox, keyed by their PSID.
 *
 * Asking for one person at a time — GET /{psid} — is the Messenger User
 * Profile API, and it answers "Object with ID '…' does not exist, cannot be
 * loaded due to missing permissions, or does not support this operation."
 * unless the app holds profile access for that specific person.
 *
 * The Page's own conversations edge returns the same names, for every thread
 * at once, using the inbox permissions the app already needs to read messages
 * in the first place. So that's the way in: one list, not N lookups.
 */
export async function fetchInboxParticipants(
  maxPages = 5
): Promise<{ names: Map<string, string>; error?: string }> {
  if (!(await endpointFor("facebook"))) {
    return { names: new Map(), error: "Facebook isn't connected yet." };
  }

  // Addressed to /me, never to the saved Page ID. A token knows which Page
  // it belongs to; a hand-typed ID in a settings box is one fat finger away
  // from "Object with ID '…' does not exist", which is what was happening —
  // replies sent fine because sending already went through /me, while every
  // read addressed to /{page-id} failed.
  const identity = await getPageIdentity();

  const names = new Map<string, string>();

  // Both inboxes. Instagram threads live on the same edge under a different
  // platform, and missing them is why Instagram customers had no name.
  for (const platform of ["facebook", "instagram"] as const) {
    const endpoint = await endpointFor(platform);
    if (!endpoint) continue;

    if (inboxIsResting(`${platform}-names`)) continue;

    let url: string | undefined = `${endpoint.base}/me/conversations`;
    let params: Record<string, string> | undefined = {
      // Only graph.facebook.com splits one edge by platform. On Instagram's
      // own host the conversations edge is already Instagram's.
      ...(endpoint.base === IG_GRAPH ? {} : { platform: inboxParam(platform) }),
      fields: "participants",
      // Instagram's conversations edge is slower than Messenger's and answers
      // big pages with "Please reduce the amount of data you're asking for",
      // or simply doesn't answer inside the timeout. Twenty-five was still too
      // many — it kept refusing — so ask it for very little and page instead.
      limit: platform === "instagram" ? "8" : "100",
      access_token: endpoint.token,
    };

    for (let page = 0; page < maxPages && url; page += 1) {
      try {
        const { data }: { data: InboxPage } = await getShrinking(
          platform,
          url,
          params,
          platform === "instagram" ? 30000 : 12000
        );

        for (const thread of data.data ?? []) {
          for (const person of thread.participants?.data ?? []) {
            // The Page itself is a participant in every thread. Skip it.
            if (!person.id || person.id === identity?.id) continue;
            const named = realName(person.name);
            if (named) names.set(person.id, named);
          }
        }

        noteInboxSuccess(`${platform}-names`);

        // paging.next is a fully-formed URL with the token already on it.
        url = data.paging?.next;
        params = undefined;
      } catch (error) {
        const detail = describeGraphError("conversations", error);
        noteInboxFailure(`${platform}-names`);
        // One inbox failing (commonly Instagram, when it isn't linked) must
        // not throw away the names the other one gave us.
        console.error(`[Facebook] ${platform} inbox list failed — ${detail}`);
        if (platform === "facebook" && names.size === 0) return { names, error: detail };
        break;
      }
    }
  }

  return { names };
}

/** What graph.facebook.com calls each inbox on the conversations edge. */
function inboxParam(platform: Platform): string {
  return platform === "instagram" ? "instagram" : "messenger";
}

/** A Graph failure as one line, whether it came back as HTTP or as a throw. */
function describeGraphError(what: string, error: unknown): string {
  const err = error as { response?: { status?: number; data?: unknown } };
  return err.response
    ? `${what} → HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 240)}`
    : `${what} → ${(error as Error).message}`;
}

/**
 * Who the saved token actually belongs to.
 *
 * Also repairs the saved Page ID when it disagrees, because a wrong one
 * silently breaks posting to the Page feed in the same way it broke reading
 * the inbox — and nothing else would ever notice.
 */
// Keyed by the token, so pasting a new one in Settings re-identifies the
// Page instead of serving a stale answer for the life of the process.
let pageIdentity: { forToken: string; id: string; name?: string } | null = null;

export async function getPageIdentity(): Promise<{ id: string; name?: string } | null> {
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) return null;
  if (pageIdentity?.forToken === config.pageAccessToken) return pageIdentity;

  try {
    const { data } = await axios.get(`${GRAPH}/me`, {
      params: { fields: "id,name", access_token: config.pageAccessToken },
      timeout: 8000,
    });
    if (!data?.id) return null;

    pageIdentity = { forToken: config.pageAccessToken, id: String(data.id), name: data.name };
    if (config.pageId !== pageIdentity.id) {
      console.log(
        `[Facebook] Saved Page ID was ${config.pageId} but the token belongs to ${pageIdentity.id} — corrected`
      );
      await updatePageIdentity(pageIdentity.id, pageIdentity.name);
    }
    return pageIdentity;
  } catch (error) {
    const err = error as { response?: { status?: number; data?: unknown } };
    console.error(
      `[Facebook] Couldn't identify the Page from the token — ${
        err.response ? `HTTP ${err.response.status}` : (error as Error).message
      }`
    );
    return null;
  }
}

/**
 * Every id the studio itself goes by, per inbox.
 *
 * The Page id is only the studio on MESSENGER. On Instagram the studio is its
 * Instagram business account, a different number entirely, and code that
 * asked "is this participant the Page?" of an Instagram thread got "no" for
 * the studio itself. That is the root of every THEY SAID card this app has
 * shown: the webhook made that mistake until 22 September, and the Instagram
 * import went on making it after — taking the studio for the customer and
 * relabelling every message in the thread the wrong way round every three
 * minutes. The studio's replies became "the customer said", and real
 * customers' messages became the studio's and dropped off the board.
 *
 * Gathered three ways, because any one can fail on a given day:
 * - the Page, from its token (`getPageIdentity`);
 * - the Instagram account linked to that Page, asked of Graph;
 * - whatever Meta's own webhooks name as the account a delivery is about
 *   (`entry.id`), remembered in the database so a boot with Graph
 *   unreachable still knows.
 */
export interface OwnAccounts {
  facebook: Set<string>;
  instagram: Set<string>;
  all: Set<string>;
}

const OWN_IDS_SETTING = "own_account_ids";
let rememberedOwn: { facebook: Set<string>; instagram: Set<string> } | null = null;
let linkedInstagram: { key: string; ids: string[] } | null = null;

async function loadRememberedOwn() {
  if (rememberedOwn) return rememberedOwn;
  const fresh = { facebook: new Set<string>(), instagram: new Set<string>() };
  try {
    const { getSetting } = await import("./db.js");
    const raw = await getSetting(OWN_IDS_SETTING);
    const parsed = raw ? (JSON.parse(raw) as { facebook?: string[]; instagram?: string[] }) : {};
    for (const id of parsed.facebook ?? []) fresh.facebook.add(String(id));
    for (const id of parsed.instagram ?? []) fresh.instagram.add(String(id));
  } catch {
    // A missing or unreadable setting just means nothing remembered yet.
  }
  rememberedOwn = fresh;
  return fresh;
}

/**
 * Note an id Meta has told us is the studio's own.
 *
 * Called with `entry.id` from every webhook delivery. Only ever the account a
 * delivery is ABOUT — never a sender — so a customer's id cannot get in here.
 */
export async function rememberOwnAccountId(
  platform: Platform,
  id: string | number | undefined | null
): Promise<void> {
  if (id === undefined || id === null || id === "") return;
  const own = await loadRememberedOwn();
  const key = String(id);
  if (own[platform].has(key)) return;
  own[platform].add(key);
  try {
    const { setSetting } = await import("./db.js");
    await setSetting(
      OWN_IDS_SETTING,
      JSON.stringify({ facebook: [...own.facebook], instagram: [...own.instagram] })
    );
    console.log(`[Facebook] Noted ${key} as the studio's own ${platform} account`);
  } catch (error) {
    console.error("[Facebook] Couldn't store an own-account id:", (error as Error).message);
  }
}

/** The Instagram account(s) behind the saved tokens, asked of Graph. */
async function lookUpLinkedInstagram(): Promise<string[]> {
  const config = await getFacebookConfig().catch(() => undefined);
  if (!config) return [];
  const key = `${config.pageAccessToken ?? ""}|${config.instagramAccessToken ?? ""}`;
  if (linkedInstagram?.key === key) return linkedInstagram.ids;

  const found = new Set<string>();
  let anyAnswered = false;

  // The Instagram account linked to the Page — what the Page-token flow uses.
  const pageTokens = [config.pageAccessToken];
  if (config.instagramAccessToken && config.instagramTokenHost === "facebook") {
    pageTokens.push(config.instagramAccessToken);
  }
  for (const token of [...new Set(pageTokens.filter(Boolean))]) {
    try {
      const { data } = await axios.get(`${GRAPH}/me`, {
        params: { fields: "instagram_business_account", access_token: token },
        timeout: 8000,
      });
      anyAnswered = true;
      if (data?.instagram_business_account?.id) found.add(String(data.instagram_business_account.id));
    } catch {
      // Tried again next time — nothing is cached on a failure.
    }
  }

  // An Instagram-login token names its own account, under two ids.
  if (config.instagramAccessToken && config.instagramTokenHost !== "facebook") {
    try {
      const { data } = await axios.get(`${IG_GRAPH}/me`, {
        params: { fields: "id,user_id", access_token: config.instagramAccessToken },
        timeout: 8000,
      });
      anyAnswered = true;
      if (data?.id) found.add(String(data.id));
      if (data?.user_id) found.add(String(data.user_id));
    } catch {
      // As above.
    }
  }

  const ids = [...found];
  if (anyAnswered) linkedInstagram = { key, ids };
  return ids;
}

export async function getOwnAccountIds(): Promise<OwnAccounts> {
  const own = await loadRememberedOwn();
  const facebook = new Set(own.facebook);
  const instagram = new Set(own.instagram);

  const identity = await getPageIdentity().catch(() => null);
  if (identity?.id) facebook.add(identity.id);
  for (const id of await lookUpLinkedInstagram().catch(() => [] as string[])) instagram.add(id);

  return { facebook, instagram, all: new Set([...facebook, ...instagram]) };
}

/**
 * Which participant in a thread is the customer — or null when that can't
 * be said for certain.
 *
 * Refusing is the point. The import relabels who said what on the strength
 * of this answer, and a wrong answer inverts a whole thread; a thread left
 * alone for one pass costs nothing, because the webhook already has it.
 *
 * Certain means: we know at least one id the studio uses on this inbox, and
 * exactly one participant is not one of ours.
 */
export function pickCustomer(
  participants: { id?: string; name?: string }[] | undefined,
  own: OwnAccounts,
  platform: Platform
): { id: string; name?: string } | null {
  if (own[platform].size === 0) return null;
  const people = (participants ?? []).filter((p): p is { id: string; name?: string } => !!p.id);
  const theirs = people.filter((p) => !own.all.has(String(p.id)));
  return theirs.length === 1 ? { ...theirs[0], id: String(theirs[0].id) } : null;
}

interface InboxPage {
  data?: { participants?: { data?: { id?: string; name?: string }[] } }[];
  paging?: { next?: string };
}

/**
 * Ask for ONE person's thread instead of walking the whole inbox.
 *
 * This is Meta's own documented answer to error 2534084, "your query has
 * timed out since you have too many conversations with users" — the error
 * that has made this studio's Instagram history unreadable through three
 * separate attempts to ask for less. Page size and field list were never the
 * lever; the cost is Meta walking the edge. `user_id` means it never walks
 * it: it goes straight to that one conversation.
 *
 * The app already knows the IGSID of everyone who has ever webhooked in, so
 * the set of people worth asking about is sitting in the database. One call
 * per unnamed person, no enumeration.
 *
 * Returns the participant who is not the Page.
 */
export async function getThreadParticipant(
  userId: string,
  platform: Platform = "instagram"
): Promise<{ name?: string; avatarUrl?: string } | null> {
  const endpoint = await endpointFor(platform);
  if (!endpoint) return null;

  // Share the profile lookup's back-off. A permission refusal is about the
  // app, not the person, so asking for the next twenty gets the same answer
  // twenty more times — and it did exactly that on the first live run: one
  // 403 per unnamed thread, every couple of minutes, which is the shape of
  // noise this file already warns makes real faults unreadable.
  const blocked = profileLookupBlocked.get(platform);
  if (blocked && Date.now() < blocked.until) return null;

  const identity = await getPageIdentity().catch(() => null);

  try {
    const { data } = await axios.get<InboxPage>(`${endpoint.base}/me/conversations`, {
      params: {
        // Only graph.facebook.com splits the edge by platform; on Instagram's
        // own host the conversations edge is already Instagram's.
        ...(endpoint.base === IG_GRAPH ? {} : { platform: inboxParam(platform) }),
        user_id: userId,
        fields: "participants",
        access_token: endpoint.token,
      },
      timeout: 12000,
    });

    for (const thread of data.data ?? []) {
      for (const person of thread.participants?.data ?? []) {
        if (!person.id || person.id === identity?.id) continue;
        // Match the person asked about where the id is given; some responses
        // name only the customer, which is the one we want anyway.
        if (person.id !== userId && (thread.participants?.data?.length ?? 0) > 1) continue;
        const named = realName(person.name);
        const avatarUrl =
          (person as { profile_pic?: string }).profile_pic ||
          (person as { profile_picture_url?: string }).profile_picture_url;
        if (named || avatarUrl) return { name: named || undefined, avatarUrl };
      }
    }
    return null;
  } catch (error) {
    const detail = describeGraphError("conversations?user_id", error);
    lastProfileError = { message: detail, at: new Date().toISOString() };

    if (profileRefusalIsPermanent(detail)) {
      const first = !profileLookupBlocked.has(platform);
      profileLookupBlocked.set(platform, { until: Date.now() + 60 * 60 * 1000, why: detail });
      if (first) {
        console.warn(
          `[Facebook] ${platform} won't name anyone by thread either — not asking again for an hour. ${detail}`
        );
      }
      return null;
    }

    console.error(`[Facebook] ${platform} thread lookup for ${userId} failed — ${detail}`);
    return null;
  }
}

interface ThreadPage {
  data?: {
    id?: string;
    participants?: { data?: { id?: string; name?: string }[] };
    messages?: {
      data?: {
        id?: string;
        message?: string;
        created_time?: string;
        from?: { id?: string; name?: string };
        // A reference photo with no words is the commonest enquiry there is.
        attachments?: {
          data?: {
            mime_type?: string;
            file_url?: string;
            image_data?: { url?: string; preview_url?: string };
          }[];
        };
      }[];
    };
  }[];
  paging?: { next?: string };
}

/** One thread as the importer stores it, however it was fetched. */
type InboxThread = NonNullable<ThreadPage["data"]>[number];

/**
 * Instagram's thread list, asked for as cheaply as Graph will allow.
 *
 * The old shape asked `/me/conversations` for the threads AND the messages
 * on them AND the attachments on those, in one request, and shrank the page
 * when Instagram refused. Shrinking the page never worked, because the page
 * size was never the expensive part: at one conversation Meta was still
 * being asked to assemble ten messages with their attachment blobs, and it
 * still answered
 *
 *   HTTP 500 "Please reduce the amount of data you're asking for"
 *   HTTP 400 (2534084) "your query has timed out since you have too many
 *                       conversations with users"
 *
 * — the second of which is Meta saying, in as many words, that walking the
 * edge is what timed out. So ask the edge for nothing but ids and names, and
 * let the messages be fetched thread by thread afterwards.
 *
 * If even that is refused after shrinking, and nothing at all came back, try
 * once more without `participants`, the only remaining field with a sub-edge
 * behind it. A partial list is never thrown away for that — some threads are
 * worth more than a tidier request.
 */
async function listInstagramThreads(
  endpoint: { base: string; token: string },
  maxThreads: number
): Promise<{ threads: InboxThread[]; failed?: string }> {
  let threads: InboxThread[] = [];
  let failed: string | undefined;

  for (const fields of ["id,participants", "id"]) {
    const found: InboxThread[] = [];
    let url: string | undefined = `${endpoint.base}/me/conversations`;
    let params: Record<string, string> | undefined = {
      // Only graph.facebook.com splits one edge by platform. On Instagram's
      // own host the conversations edge is already Instagram's.
      ...(endpoint.base === IG_GRAPH ? {} : { platform: inboxParam("instagram") }),
      fields,
      // Ten ids is a small ask, and getShrinking is still behind it in case
      // this inbox grows past what Instagram will enumerate at once.
      limit: "10",
      access_token: endpoint.token,
    };

    failed = undefined;
    let tooMuch = false;

    while (url && found.length < maxThreads) {
      try {
        const { data }: { data: ThreadPage } = await getShrinking(
          "instagram",
          url,
          params,
          30000
        );
        for (const thread of data.data ?? []) {
          if (found.length >= maxThreads) break;
          if (thread.id) found.push(thread);
        }
        url = data.paging?.next;
        params = undefined;
      } catch (error) {
        failed = describeGraphError("conversations", error);
        tooMuch = asksForTooMuch(error);
        break;
      }
    }

    if (found.length > threads.length) threads = found;
    // Retry without participants only when the size is what was refused and
    // the attempt produced nothing. A permission refusal reads the same
    // however few fields are asked for.
    if (!failed || !tooMuch || threads.length > 0) break;
  }

  return { threads, failed };
}

/**
 * The messages on one Instagram thread, asked for on their own.
 *
 * One small request per thread is far less work for Graph than one request
 * that makes it assemble every thread at once, and it degrades one thread at
 * a time instead of losing the lot. Ten messages is plenty of history for a
 * draft; if even that is refused, ask for fewer.
 *
 * The attachments stay on every attempt. Dropping them is the obvious next
 * thing to shrink and it is the wrong thing to shrink here: a photo with no
 * words is the commonest enquiry this studio gets, and without the
 * attachment field such a message has no text and no picture, so it is
 * indistinguishable from nothing and would be silently skipped. Asking for
 * fewer messages saves the same work and loses nothing.
 */
async function fetchInstagramThread(
  endpoint: { base: string; token: string },
  threadId: string
): Promise<{ thread?: InboxThread; failed?: string }> {
  let failed: string | undefined;

  /**
   * Ask for less each time, on a shorter clock each time.
   *
   * A TIMEOUT is the commonest way this fails in production, and it used to
   * end the thread outright: only an explicit "that was too much" earned a
   * retry, so a thread that merely took longer than twenty seconds was
   * abandoned with ten messages still unasked for. The live log is full of
   * `wouldn't open — timeout of 20000ms exceeded`, and every one of those is
   * a thread whose history never arrived AND whose mislabelled senders never
   * got corrected, because the correction only happens on a thread that
   * opens.
   *
   * A timeout means the same thing as Meta saying so in words: too much to
   * assemble. So it earns the same smaller ask. The clock shortens with the
   * page because a smaller page that is still slow is a thread to leave for
   * the next pass rather than spend the whole run on: three attempts cost at
   * most 40 seconds, inside the 100-second deadline the caller holds.
   */
  for (const [limit, budget] of [
    [10, 20000],
    [3, 12000],
    [1, 8000],
  ] as const) {
    try {
      const { data } = await axios.get<InboxThread>(`${endpoint.base}/${threadId}`, {
        params: {
          fields: `participants,messages.limit(${limit}){id,message,created_time,from,attachments{image_data,file_url,mime_type}}`,
          access_token: endpoint.token,
        },
        timeout: budget,
      });
      return { thread: data };
    } catch (error) {
      failed = describeGraphError(`thread ${threadId}`, error);
      const timedOut = (error as { code?: string }).code === "ECONNABORTED";
      // Anything else comes back the same however little is asked for, so
      // asking again only costs time a customer is waiting through.
      if (!asksForTooMuch(error) && !timedOut) break;
    }
  }

  return { failed };
}

export interface ImportedThreads {
  conversations: number;
  messages: number;
  /** Messages whose sender was stored wrong and has now been put right. */
  corrected: number;
  /** Per-platform notes, including why one came back empty. */
  detail: string;
}

/**
 * Pulls the threads already sitting in the studio's Meta inbox.
 *
 * A webhook only ever carries what happens next. Everyone who wrote in
 * before the app was connected — or before Instagram was switched on — is
 * invisible here until they happen to message again, which for a studio
 * means an enquiry from last week silently never gets answered.
 *
 * So this reads the conversations edge with the messages on it, and stores
 * what it finds the same way a live delivery would. It deliberately does not
 * draft replies: writing to fifty people at once off the back of a button
 * press is not something anyone wants, and half these conversations were
 * already answered by hand.
 *
 * Messenger is read in one request per page of threads with the messages
 * nested on it, which is what it has always done and what works. Instagram
 * refuses that shape on this studio's inbox at every page size, so it lists
 * the threads first and fetches each one after — see listInstagramThreads.
 * Both end up in storeThread, so the two ways in cannot drift apart on who
 * said what, or on being idempotent per message id.
 */
export async function importExistingConversations(
  maxThreads = 1000,
  /**
   * Ask even if this inbox has just refused us.
   *
   * The back-off exists so the three-minute poll stops hammering an inbox
   * Meta is turning away. It must not apply when a person presses Import —
   * pressing the button IS the instruction to try now, and a button that
   * quietly does nothing for the next half hour is worse than one that
   * fails honestly.
   */
  force = false
): Promise<ImportedThreads> {
  const {
    getOrCreateConversation,
    recordMessage,
    correctMessageSender,
    dropDraftsAnsweringOurselves,
    retireOwnAccountThreads,
  } = await import("./db.js");
  const own = await getOwnAccountIds();
  const notes: string[] = [];
  let conversations = 0;
  let messages = 0;
  let corrected = 0;
  const unsure: Record<Platform, number> = { facebook: 0, instagram: 0 };

  /**
   * Store one thread the way a live delivery would.
   *
   * False for a thread with nobody in it but us — the Page talking to
   * itself, which has nothing to answer — and for one where we can't tell
   * which participant is the customer.
   */
  async function storeThread(thread: InboxThread, platform: Platform): Promise<boolean> {
    /**
     * Whoever isn't us — where "us" is every id the studio goes by on THIS
     * inbox, not just the Facebook Page.
     *
     * This compared against the Page id alone. On Instagram the studio is its
     * Instagram account, a different number, so when Meta listed the studio
     * first it was taken for the customer, and everything below ran the
     * wrong way round: the studio's replies relabelled "customer" (THEY SAID,
     * with a draft answering Brad's own words) and the customer's messages
     * relabelled ours, so real enquiries fell off the board within a poll.
     * Faith's, mali's and maya's cards on 25 September were the first kind;
     * Rebecca's and Megan's messages that night were the second.
     */
    const customer = pickCustomer(thread.participants?.data, own, platform);
    if (!customer) {
      unsure[platform] += 1;
      return false;
    }

    await getOrCreateConversation(customer.id, realName(customer.name), platform);
    conversations += 1;

    // Oldest first, so the stored thread reads in the order it happened.
    const turns = [...(thread.messages?.data ?? [])].reverse();
    // The newest timestamp seen so far in this thread, for the rare message
    // Graph hands over without one.
    let lastKnownTime: Date | undefined;
    for (const turn of turns) {
      if (!turn.id) continue;

      // A message with no words is still a message. Half this studio's
      // enquiries are a photo of what someone wants and nothing else —
      // skipping them imported the thread as a name with no conversation in
      // it, which is exactly how it looked.
      const photos = (turn.attachments?.data ?? [])
        .filter((a) => !a.mime_type || a.mime_type.startsWith("image/"))
        .map((a) => a.image_data?.url || a.file_url)
        .filter((u): u is string => !!u);

      const text = turn.message?.trim();
      if (!text && !photos.length) continue;

      // Anyone who isn't the customer is us — the Page, an admin replying by
      // hand, or Meta's own instant reply. Comparing against the Page
      // identity instead meant a greeting the studio sent came back labelled
      // as the customer's own words, which is worse than useless: it's what
      // the agent reads as history. Anything not positively from the
      // customer is treated as ours. Graph attaches a sender to every real
      // message; the ones without are system lines like "Brad Potter replied
      // to an ad." Putting those in the customer's mouth is the worse
      // mistake — the agent reads this back as the conversation and would
      // sit there trying to answer a status line.
      const fromId = turn.from?.id ? String(turn.from.id) : undefined;
      const fromUs = fromId !== customer.id;
      // Keep when it was actually said. Stamping the whole thread "now"
      // leaves it with no real order, and these turns are what the agent
      // reads back as the conversation.
      // Graph occasionally omits created_time. Letting that fall through to
      // "now" stamps a months-old message with today, and the thread leaps
      // to the top of the inbox past conversations that really are more
      // recent. Carry the last known time forward instead — these arrive in
      // order.
      const parsed = turn.created_time ? new Date(turn.created_time) : undefined;
      const said = parsed && !Number.isNaN(parsed.getTime()) ? parsed : lastKnownTime;
      if (said) lastKnownTime = said;
      // Keep the picture itself — Meta's links expire, and a blank box where
      // the reference photo should be is no use when the whole point is
      // pricing the tattoo in it.
      const kept = photos.length ? await cacheAttachments(photos, customer.id, turn.id) : [];

      const stored = await recordMessage(
        customer.id,
        turn.id,
        fromUs ? "manual" : "customer",
        text || "(sent a photo)",
        undefined,
        kept,
        said
      );
      if (stored) {
        messages += 1;
      } else {
        // Already stored — but possibly stored wrong. Threads imported
        // before the sender attribution was fixed have the studio's own
        // replies recorded as the customer's, which is what had the agent
        // drafting answers to its own sentences. Pressing Import again is
        // how that gets put right.
        //
        // And possibly filed under the wrong thread: the old Instagram import
        // put anything it stored for the first time under the studio's own
        // id. Now the customer is known for certain, it goes where it belongs.
        const wanted = fromUs ? "manual" : "customer";
        if (await correctMessageSender(turn.id, wanted, { into: customer.id, from: own.all })) {
          corrected += 1;
        }
      }
    }

    return true;
  }

  for (const platform of ["facebook", "instagram"] as const) {
    const endpoint = await endpointFor(platform);
    if (!endpoint) {
      notes.push(`${platform}: not connected`);
      continue;
    }

    // An inbox that has just refused us is left alone rather than asked
    // again ninety seconds later.
    if (!force && inboxIsResting(`${platform}-import`)) {
      notes.push(`${platform}: resting after a refusal`);
      continue;
    }

    let seen = 0;
    let failed = "";
    let aside = "";

    if (platform === "instagram") {
      /* ---- two phases, because Instagram will not do it in one ---- */

      const listed = await listInstagramThreads(endpoint, maxThreads);

      // The whole pass has to finish inside the three minutes between polls,
      // or the polls start overlapping and each holds a Graph connection
      // open while the next begins. Meta hands the threads back
      // most-recently-active first, so a short run still gets the ones that
      // matter and the rest come round on the next poll.
      const deadline = Date.now() + 100_000;
      let unopened = 0;
      let lastThreadError = "";
      let ranShort = false;

      for (const stub of listed.threads) {
        if (Date.now() > deadline) {
          ranShort = true;
          break;
        }
        const got = await fetchInstagramThread(endpoint, stub.id!);
        if (!got.thread) {
          // One thread refusing must not cost the others — that is the whole
          // reason for asking one at a time.
          unopened += 1;
          lastThreadError = got.failed ?? "";
          console.error(`[Facebook] instagram thread ${stub.id} wouldn't open — ${got.failed}`);
          continue;
        }
        // Participants come back on the thread itself; fall back to the ones
        // the list gave, for the run where the list had to drop them.
        const participants = got.thread.participants?.data?.length
          ? got.thread.participants
          : stub.participants;
        if (await storeThread({ ...got.thread, participants }, platform)) seen += 1;
      }

      if (listed.failed && listed.threads.length === 0) {
        failed = listed.failed;
      } else if (unopened && seen === 0) {
        // The list came back and not one thread would open. That is the
        // inbox refusing us, not one thread being odd, and it earns the rest.
        failed = lastThreadError;
      } else {
        if (listed.failed) aside += ", and the list stopped early";
        if (unopened) aside += `, ${unopened} wouldn't open`;
        if (ranShort) aside += ", stopped on time and will carry on next run";
      }
    } else {
      /* ---- Messenger, one request per page of threads, as it always was ---- */

      let url: string | undefined = `${endpoint.base}/me/conversations`;
      let params: Record<string, string> | undefined = {
        ...(endpoint.base === IG_GRAPH ? {} : { platform: inboxParam(platform) }),
        fields:
          "participants,messages.limit(100){id,message,created_time,from,attachments{image_data,file_url,mime_type}}",
        limit: "50",
        access_token: endpoint.token,
      };

      while (url && seen < maxThreads) {
        try {
          const { data }: { data: ThreadPage } = await getShrinking(platform, url, params, 20000);

          for (const thread of data.data ?? []) {
            if (seen >= maxThreads) break;
            if (await storeThread(thread, platform)) seen += 1;
          }

          url = data.paging?.next;
          params = undefined;
        } catch (error) {
          failed = describeGraphError("conversations", error);
          break;
        }
      }
    }

    if (failed) {
      noteInboxFailure(`${platform}-import`);
      console.error(`[Facebook] ${platform} import failed — ${failed}`);
    } else {
      noteInboxSuccess(`${platform}-import`);
    }

    notes.push(
      failed
        ? `${platform}: ${explainImportFailure(failed, platform)}`
        // Say so when the ceiling was actually reached, rather than stopping
        // quietly at a round number and letting it look complete.
        : `${platform}: ${seen} thread${seen === 1 ? "" : "s"}${
            seen >= maxThreads ? " (stopped at the limit — press again for the rest)" : ""
          }${aside}`
    );
  }

  // Said once per pass, in words, so a quiet import is never mistaken for an
  // empty inbox. The usual cause is not yet knowing the studio's Instagram
  // id — which the first Instagram webhook after a deploy supplies.
  for (const platform of ["facebook", "instagram"] as const) {
    if (!unsure[platform]) continue;
    const why =
      own[platform].size === 0
        ? `the studio's own ${platform} account id isn't known yet, so none of these were touched`
        : "couldn't tell which participant was the customer, so they were left alone";
    console.warn(`[Facebook] ${platform} import skipped ${unsure[platform]} thread(s) — ${why}`);
    notes.push(`${platform}: skipped ${unsure[platform]} — ${why}`);
  }

  // Any thread filed under the studio's own account is a mistake of the old
  // import. Take its drafts off the board and keep it out of "needs a reply".
  try {
    const retired = await retireOwnAccountThreads([...own.all]);
    if (retired.drafts || retired.removed) {
      console.log(
        `[Facebook] Studio's own account: removed ${retired.drafts} draft(s) addressed to itself` +
          (retired.removed ? ` and ${retired.removed} empty thread(s)` : "") +
          (retired.stillHolding ? `; ${retired.stillHolding} message(s) still waiting to be moved to their thread` : "")
      );
    }
  } catch (error) {
    console.error("[Facebook] Couldn't tidy the studio's own-account thread:", (error as Error).message);
  }

  // Any draft that was answering something we now know we said ourselves is
  // nonsense, and approving one would send a customer a reply to the
  // studio's own words.
  const droppedDrafts = corrected ? await dropDraftsAnsweringOurselves() : 0;
  if (corrected) {
    // The poll never said when it relabelled anything, which is why a whole
    // evening of the import turning threads inside out left no trace in the
    // log. Every relabel is now a line.
    console.log(`[Facebook] Import corrected who sent ${corrected} message(s)`);
  }
  if (corrected) {
    notes.push(
      `corrected who sent ${corrected} message${corrected === 1 ? "" : "s"}` +
        (droppedDrafts
          ? `, and removed ${droppedDrafts} draft${droppedDrafts === 1 ? "" : "s"} written against them`
          : "")
    );
  }

  return { conversations, messages, corrected, detail: notes.join(" · ") };
}

/** A Graph refusal turned into the sentence that says what to do about it. */
function explainImportFailure(detail: string, platform: Platform): string {
  if (/pages_messaging|instagram_.*manage_messages|permission/i.test(detail)) {
    return platform === "instagram"
      ? "Instagram messaging isn't approved for the app yet, so Meta won't hand over these threads. This will start working once App Review comes back."
      : "the token is missing the messaging permission — regenerate it with pages_messaging ticked.";
  }
  if (/expired|session has been invalidated|OAuthException/i.test(detail)) {
    return "the saved token has expired — generate a new one and paste it into Settings.";
  }
  if (/does not exist|cannot be loaded/i.test(detail)) {
    return platform === "instagram"
      ? "no Instagram account is reachable with this token, which is normal until Instagram is connected."
      : detail;
  }
  return detail;
}

/**
 * The name for one person, however it can be got.
 *
 * Tries the per-person profile lookup, and if Facebook refuses it — which is
 * what it is currently doing — reads the name out of the Page's inbox list
 * instead. The inbox is cached briefly so a burst of messages doesn't pull
 * the whole thread list once per message.
 */
let inboxCache: { at: number; names: Map<string, string> } | null = null;
const INBOX_CACHE_MS = 5 * 60 * 1000;

export async function resolveCustomerName(
  psid: string,
  platform: "facebook" | "instagram" = "facebook"
): Promise<string | undefined> {
  const profile = await getSenderProfile(psid, platform);
  if (profile?.name) return profile.name;

  const fresh = inboxCache && Date.now() - inboxCache.at < INBOX_CACHE_MS;
  if (fresh && inboxCache!.names.has(psid)) return inboxCache!.names.get(psid);

  // Either the cache is stale, or it's someone we haven't seen in it — and a
  // brand-new customer won't be in a cached copy, so refetch before giving up.
  if (!fresh || !inboxCache!.names.has(psid)) {
    const { names } = await fetchInboxParticipants();
    if (names.size > 0) inboxCache = { at: Date.now(), names };
    return names.get(psid);
  }

  return undefined;
}

/**
 * Go and get the names for threads that are already in the database.
 *
 * Filling a name in as the next message arrives fixes nothing for a thread
 * whose last message was hours ago — it just sits there saying "a customer"
 * forever, and no webhook is coming to fix it.
 *
 * Reads the inbox list first, then falls back to the per-person profile
 * lookup for anyone it didn't cover. Runs on boot and behind a button, and
 * always reports back what happened — including Facebook's own words when
 * nothing comes back, so the answer is never just "it's still not working".
 */
export async function backfillCustomerNames(limit = 50): Promise<{
  checked: number;
  named: number;
  detail: string;
}> {
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) {
    return { checked: 0, named: 0, detail: "Facebook isn't connected yet." };
  }

  const missing = await getConversationsMissingNamesWithPlatform(limit);
  if (missing.length === 0) {
    return { checked: 0, named: 0, detail: "Every thread already has a name." };
  }

  const { names: inbox, error: inboxError } = await fetchInboxParticipants();

  let named = 0;
  const stillMissing: { conversationId: string; platform: Platform }[] = [];
  for (const thread of missing) {
    const fromInbox = inbox.get(thread.conversationId);
    if (fromInbox) {
      await setConversationName(thread.conversationId, fromInbox);
      named += 1;
    } else {
      stillMissing.push(thread);
    }
  }

  // Anyone the inbox list didn't cover — try them one at a time, down the
  // path their own inbox belongs to. Asking Instagram threads over the
  // Messenger route was how an Instagram permission error came to be
  // recorded against Facebook.
  //
  // Instagram gets asked by user_id FIRST. Its inbox list above cannot be
  // walked at all — Meta times out on the edge with 2534084 — so for every
  // Instagram thread `fromInbox` is empty and always has been. Asking for
  // that one person's conversation is Meta's own documented way round it,
  // and unlike the per-person profile lookup below it is not the call that
  // has never once worked for this app.
  for (const thread of stillMissing) {
    if (thread.platform === "instagram") {
      const viaThread = await getThreadParticipant(thread.conversationId, "instagram");
      if (viaThread?.name || viaThread?.avatarUrl) {
        if (viaThread.name) await setConversationName(thread.conversationId, viaThread.name);
        if (viaThread.avatarUrl) {
          await setConversationAvatar(thread.conversationId, viaThread.avatarUrl).catch(
            () => undefined
          );
        }
        if (viaThread.name) {
          named += 1;
          continue;
        }
      }
    }

    const profile = await getSenderProfile(thread.conversationId, thread.platform);
    if (profile?.name) {
      await setConversationName(thread.conversationId, profile.name);
      named += 1;
    }
  }

  if (named === missing.length) {
    return { checked: missing.length, named, detail: `Named all ${named}.` };
  }
  const why = explainProfileFailure(
    inboxError ?? lastProfileError?.message ?? "no name available"
  );

  if (named > 0) {
    return {
      checked: missing.length,
      named,
      detail: `Named ${named} of ${missing.length}. ${why}`,
    };
  }
  // Not a failure worth alarm. A handful of unnamed threads out of hundreds
  // is the normal resting state — some people simply can't be named to a
  // Page — and the previous wording made that read as a broken app.
  return {
    checked: missing.length,
    named: 0,
    detail: `${missing.length} thread${missing.length === 1 ? "" : "s"} still without a name. ${why}`,
  };
}

export async function publishPagePost(
  content: string,
  imageUrl?: string
): Promise<string> {
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) {
    throw new Error("Facebook is not connected yet");
  }

  // /me, not the saved Page ID — same reason as the inbox read. A wrong ID
  // here would have failed every scheduled post with an object-not-found.
  // Facebook fetches the picture from the URL we hand it, so a path to a
  // photo stored here has to be made absolute first — Facebook's servers
  // have no idea what "/api/attachments/…" means.
  // Signed, because once a password is on the dashboard Facebook's fetch of
  // this picture arrives with no session and would be turned away.
  const absoluteImage = imageUrl
    ? publicUrl(imageUrl.startsWith("/") ? signAssetPath(imageUrl) : imageUrl)
    : undefined;
  if (imageUrl && !absoluteImage) {
    throw new Error(
      "This post has an uploaded photo, but the app doesn't know its own public address. " +
        "Set PUBLIC_URL in the hosting environment to the dashboard's URL and try again."
    );
  }

  const endpoint = absoluteImage ? `${GRAPH}/me/photos` : `${GRAPH}/me/feed`;

  const payload = absoluteImage
    ? { url: absoluteImage, caption: content, access_token: config.pageAccessToken }
    : { message: content, access_token: config.pageAccessToken };

  try {
    const { data } = await axios.post(endpoint, payload, { timeout: 30000 });
    return (data.post_id || data.id) as string;
  } catch (error) {
    const err = error as { response?: { data?: { error?: { message?: string } } } };
    const raw = err.response?.data?.error?.message ?? (error as Error).message;
    throw new Error(explainPublishFailure(raw));
  }
}

/**
 * Why a post didn't go up, in words the studio can act on.
 *
 * The raw text of a Graph refusal was being printed on the card — "(#200) The
 * permission(s) pages_manage_posts are not available. It could because either
 * they are deprecated or need to be approved by App Review." — which is both
 * ungrammatical and useless to someone who doesn't know what a permission is.
 *
 * The distinction that matters, learned the hard way on pages_read_engagement:
 * a permission the app has not been granted cannot be fixed by generating a
 * new token, and saying "check your token" sends someone round a loop that
 * cannot end. So name the real place it is granted.
 */
export function explainPublishFailure(raw: string): string {
  if (/pages_manage_posts/i.test(raw)) {
    return (
      "Facebook won't let the app post to the Page yet. Posting needs the " +
      "pages_manage_posts permission, and it hasn't been granted to this app — that's " +
      "requested in the Meta app dashboard under App Review → Permissions and Features, " +
      "the same place as pages_read_engagement. Nothing on this screen or in the token " +
      "can fix it, and the post is kept so it can go up once it's approved. Messages and " +
      "replies are unaffected."
    );
  }
  if (/Session has expired|Error validating access token|code.{0,4}190/i.test(raw)) {
    return (
      "The saved Page token has expired, so Facebook turned the post away. Paste a fresh " +
      "one in Settings and the post can be scheduled again — nothing was lost."
    );
  }
  if (/pages_read_engagement|Page Public Content Access/i.test(raw)) {
    return (
      "Facebook refused because the app hasn't been granted the permission it needs for " +
      "this Page. Request it in the Meta app dashboard under App Review → Permissions and " +
      "Features; a new token won't help."
    );
  }
  // Something genuinely unfamiliar. Trim it, but don't pretend to understand.
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
}
