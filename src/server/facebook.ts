import crypto from "node:crypto";
import axios from "axios";
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
    return { base: IG_GRAPH, token: config.instagramAccessToken };
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
  fields: string[];
  missing: string[];
  detail: string;
}> {
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) {
    return { subscribed: false, fields: [], missing: [], detail: "Facebook isn't connected yet." };
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
        fields: [],
        missing: [...MESSENGER_FIELDS],
        detail: "This Page is NOT subscribed to the app, so Facebook sends it nothing.",
      };
    }

    const fields = apps.flatMap((app) => app.subscribed_fields ?? []);
    const missing = MESSENGER_FIELDS.filter((f) => !fields.includes(f));
    return {
      subscribed: true,
      fields,
      missing,
      detail: missing.length
        ? `Subscribed, but not for: ${missing.join(", ")}.`
        : "Subscribed, and receiving every message event.",
    };
  } catch (error) {
    const err = error as { response?: { status?: number; data?: unknown } };
    return {
      subscribed: false,
      fields: [],
      missing: [],
      detail: err.response
        ? `Couldn't check — HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`
        : `Couldn't check — ${(error as Error).message}`,
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
      }[];
    };
  }[];
  paging?: { next?: string };
}

export interface ImportedThreads {
  conversations: number;
  messages: number;
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
  maxThreads = 100
): Promise<ImportedThreads> {
  const { getOrCreateConversation, recordMessage } = await import("./db.js");
  const identity = await getPageIdentity();
  const notes: string[] = [];
  let conversations = 0;
  let messages = 0;

  for (const platform of ["facebook", "instagram"] as const) {
    const endpoint = await endpointFor(platform);
    if (!endpoint) {
      notes.push(`${platform}: not connected`);
      continue;
    }

    let url: string | undefined = `${endpoint.base}/me/conversations`;
    let params: Record<string, string> | undefined = {
      ...(endpoint.base === IG_GRAPH ? {} : { platform: inboxParam(platform) }),
      fields: "participants,messages.limit(25){id,message,created_time,from}",
      limit: "25",
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
          for (const turn of turns) {
            if (!turn.id || !turn.message?.trim()) continue;
            const fromUs = turn.from?.id === identity?.id;
            // Keep when it was actually said. Stamping the whole thread
            // "now" leaves it with no real order, and these turns are what
            // the agent reads back as the conversation.
            const said = turn.created_time ? new Date(turn.created_time) : undefined;
            const stored = await recordMessage(
              customer.id,
              turn.id,
              fromUs ? "manual" : "customer",
              turn.message.trim(),
              undefined,
              undefined,
              said && !Number.isNaN(said.getTime()) ? said : undefined
            );
            // recordMessage returns false for a message already stored, which
            // is how running this twice stays harmless.
            if (stored) messages += 1;
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
        : `${platform}: ${seen} thread${seen === 1 ? "" : "s"}`
    );
  }

  return { conversations, messages, detail: notes.join(" · ") };
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
  if (named > 0) {
    return {
      checked: missing.length,
      named,
      detail: `Named ${named} of ${missing.length}. For the rest, Facebook said: ${
        inboxError ?? lastProfileError?.message ?? "no name available"
      }`,
    };
  }
  return {
    checked: missing.length,
    named: 0,
    detail: `No names came back for any of the ${missing.length}. Facebook said: ${
      inboxError ?? lastProfileError?.message ?? "no name available"
    }`,
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
  const absoluteImage = imageUrl ? publicUrl(imageUrl) : undefined;
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

  const { data } = await axios.post(endpoint, payload, { timeout: 30000 });
  return (data.post_id || data.id) as string;
}
