import crypto from "node:crypto";
import axios from "axios";
import { signAssetPath } from "./auth.js";
import { cacheAttachments } from "./attachments.js";
import {
  getFacebookConfig,
  getConversationsMissingNames,
  setConversationName,
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

export async function sendMessengerMessage(
  recipientId: string,
  messageText: string,
  platform: Platform = "facebook"
): Promise<void> {
  const endpoint = await endpointFor(platform);
  if (!endpoint) throw new Error("Facebook is not connected yet");

  await axios.post(
    `${endpoint.base}/me/messages`,
    {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text: messageText },
    },
    { params: { access_token: endpoint.token }, timeout: 15000 }
  );
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
  if (/does not have the capability|\(#3\)/i.test(detail)) {
    return "Facebook won't give this app people's names one at a time — it never has. Names come from the Page inbox instead, which is why almost everyone is named. The few that aren't are people Facebook won't name to a Page at all.";
  }
  if (/does not exist|cannot be loaded|missing permissions|Unsupported get request/i.test(detail)) {
    return "Facebook won't release these customers' names. That happens with restricted or deactivated accounts, and it isn't something the app can fix — everyone else is named from the Page inbox as normal.";
  }
  if (/expired|session has been invalidated|OAuthException/i.test(detail)) {
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

export async function getSenderProfile(
  senderId: string,
  platform: Platform = "facebook"
): Promise<{ name?: string } | null> {
  const endpoint = await endpointFor(platform);
  if (!endpoint) return null;

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

    let url: string | undefined = `${endpoint.base}/me/conversations`;
    let params: Record<string, string> | undefined = {
      // Only graph.facebook.com splits one edge by platform. On Instagram's
      // own host the conversations edge is already Instagram's.
      ...(endpoint.base === IG_GRAPH ? {} : { platform: inboxParam(platform) }),
      fields: "participants",
      limit: "100",
      access_token: endpoint.token,
    };

    for (let page = 0; page < maxPages && url; page += 1) {
      try {
        const { data }: { data: InboxPage } = await axios.get(url, { params, timeout: 12000 });

        for (const thread of data.data ?? []) {
          for (const person of thread.participants?.data ?? []) {
            // The Page itself is a participant in every thread. Skip it.
            if (!person.id || person.id === identity?.id) continue;
            const named = realName(person.name);
            if (named) names.set(person.id, named);
          }
        }

        // paging.next is a fully-formed URL with the token already on it.
        url = data.paging?.next;
        params = undefined;
      } catch (error) {
        const detail = describeGraphError("conversations", error);
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

interface InboxPage {
  data?: { participants?: { data?: { id?: string; name?: string }[] } }[];
  paging?: { next?: string };
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
 */
export async function importExistingConversations(
  maxThreads = 1000
): Promise<ImportedThreads> {
  const { getOrCreateConversation, recordMessage, correctMessageSender, dropDraftsAnsweringOurselves } =
    await import("./db.js");
  const identity = await getPageIdentity();
  const notes: string[] = [];
  let conversations = 0;
  let messages = 0;
  let corrected = 0;

  for (const platform of ["facebook", "instagram"] as const) {
    const endpoint = await endpointFor(platform);
    if (!endpoint) {
      notes.push(`${platform}: not connected`);
      continue;
    }

    let url: string | undefined = `${endpoint.base}/me/conversations`;
    let params: Record<string, string> | undefined = {
      ...(endpoint.base === IG_GRAPH ? {} : { platform: inboxParam(platform) }),
      fields:
        "participants,messages.limit(100){id,message,created_time,from,attachments{image_data,file_url,mime_type}}",
      limit: "50",
      access_token: endpoint.token,
    };

    let seen = 0;
    let failed = "";

    while (url && seen < maxThreads) {
      try {
        const { data }: { data: ThreadPage } = await axios.get(url, {
          params,
          timeout: 20000,
        });

        for (const thread of data.data ?? []) {
          if (seen >= maxThreads) break;
          // Whoever isn't us. A thread with nobody else in it is the Page
          // talking to itself and there's nothing to answer.
          const customer = (thread.participants?.data ?? []).find(
            (p) => p.id && p.id !== identity?.id
          );
          if (!customer?.id) continue;
          seen += 1;

          await getOrCreateConversation(customer.id, realName(customer.name), platform);
          conversations += 1;

          // Oldest first, so the stored thread reads in the order it happened.
          const turns = [...(thread.messages?.data ?? [])].reverse();
          // The newest timestamp seen so far in this thread, for the rare
          // message Graph hands over without one.
          let lastKnownTime: Date | undefined;
          for (const turn of turns) {
            if (!turn.id) continue;

            // A message with no words is still a message. Half this studio's
            // enquiries are a photo of what someone wants and nothing else —
            // skipping them imported the thread as a name with no
            // conversation in it, which is exactly how it looked.
            const photos = (turn.attachments?.data ?? [])
              .filter((a) => !a.mime_type || a.mime_type.startsWith("image/"))
              .map((a) => a.image_data?.url || a.file_url)
              .filter((u): u is string => !!u);

            const text = turn.message?.trim();
            if (!text && !photos.length) continue;

            // Anyone who isn't the customer is us — the Page, an admin
            // replying by hand, or Meta's own instant reply. Comparing
            // against the Page identity instead meant a greeting the studio
            // sent came back labelled as the customer's own words, which is
            // worse than useless: it's what the agent reads as history.
            // Anything not positively from the customer is treated as ours.
            // Graph attaches a sender to every real message; the ones without
            // are system lines like "Brad Potter replied to an ad." Putting
            // those in the customer's mouth is the worse mistake — the agent
            // reads this back as the conversation and would sit there trying
            // to answer a status line.
            const fromId = turn.from?.id;
            const fromUs = fromId !== customer.id;
            // Keep when it was actually said. Stamping the whole thread
            // "now" leaves it with no real order, and these turns are what
            // the agent reads back as the conversation.
            // Graph occasionally omits created_time. Letting that fall
            // through to "now" stamps a months-old message with today, and
            // the thread leaps to the top of the inbox past conversations
            // that really are more recent. Carry the last known time
            // forward instead — these arrive in order.
            const parsed = turn.created_time ? new Date(turn.created_time) : undefined;
            const said =
              parsed && !Number.isNaN(parsed.getTime()) ? parsed : lastKnownTime;
            if (said) lastKnownTime = said;
            // Keep the picture itself — Meta's links expire, and a blank
            // box where the reference photo should be is no use when the
            // whole point is pricing the tattoo in it.
            const kept = photos.length
              ? await cacheAttachments(photos, customer.id, turn.id)
              : [];

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
              // replies recorded as the customer's, which is what had the
              // agent drafting answers to its own sentences. Pressing Import
              // again is how that gets put right.
              const wanted = fromUs ? "manual" : "customer";
              if (await correctMessageSender(turn.id, wanted)) corrected += 1;
            }
          }
        }

        url = data.paging?.next;
        params = undefined;
      } catch (error) {
        failed = describeGraphError("conversations", error);
        console.error(`[Facebook] ${platform} import failed — ${failed}`);
        break;
      }
    }

    notes.push(
      failed
        ? `${platform}: ${explainImportFailure(failed, platform)}`
        // Say so when the ceiling was actually reached, rather than stopping
        // quietly at a round number and letting it look complete.
        : `${platform}: ${seen} thread${seen === 1 ? "" : "s"}${
            seen >= maxThreads ? " (stopped at the limit — press again for the rest)" : ""
          }`
    );
  }

  // Any draft that was answering something we now know we said ourselves is
  // nonsense, and approving one would send a customer a reply to the
  // studio's own words.
  const droppedDrafts = corrected ? await dropDraftsAnsweringOurselves() : 0;
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

  const missing = await getConversationsMissingNames(limit);
  if (missing.length === 0) {
    return { checked: 0, named: 0, detail: "Every thread already has a name." };
  }

  const { names: inbox, error: inboxError } = await fetchInboxParticipants();

  let named = 0;
  const stillMissing: string[] = [];
  for (const conversationId of missing) {
    const fromInbox = inbox.get(conversationId);
    if (fromInbox) {
      await setConversationName(conversationId, fromInbox);
      named += 1;
    } else {
      stillMissing.push(conversationId);
    }
  }

  // Anyone the inbox list didn't cover — try them one at a time.
  for (const conversationId of stillMissing) {
    const profile = await getSenderProfile(conversationId);
    if (profile?.name) {
      await setConversationName(conversationId, profile.name);
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
