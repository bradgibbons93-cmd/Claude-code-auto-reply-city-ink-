import crypto from "node:crypto";
import axios from "axios";
import {
  getFacebookConfig,
  getConversationsMissingNames,
  setConversationName,
  updatePageIdentity,
} from "./db.js";

// Overridable so the whole thing can be run end to end against a stand-in
// Graph API. Unset everywhere except a test run, which is the only way to
// watch a real page render a real name without messaging the studio.
const GRAPH = process.env.FACEBOOK_GRAPH_URL || "https://graph.facebook.com/v21.0";

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
  messageText: string
): Promise<void> {
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) throw new Error("Facebook is not connected yet");

  await axios.post(
    `${GRAPH}/me/messages`,
    {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text: messageText },
    },
    { params: { access_token: config.pageAccessToken }, timeout: 15000 }
  );
}

export async function sendTypingIndicator(recipientId: string): Promise<void> {
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) return;
  try {
    await axios.post(
      `${GRAPH}/me/messages`,
      { recipient: { id: recipientId }, sender_action: "typing_on" },
      { params: { access_token: config.pageAccessToken }, timeout: 8000 }
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
  senderId: string
): Promise<{ name?: string } | null> {
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) return null;

  // Facebook is inconsistent about which name fields a Page token may read,
  // and it varies with how the app was reviewed. Try the split fields, then
  // the combined one, before concluding there's no name to be had.
  const attempts = ["first_name,last_name", "name"];
  let lastDetail = "";

  for (const fields of attempts) {
    try {
      const { data } = await axios.get(`${GRAPH}/${senderId}`, {
        params: { fields, access_token: config.pageAccessToken },
        timeout: 8000,
      });
      const name =
        [data.first_name, data.last_name].filter(Boolean).join(" ") || data.name || "";
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
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) {
    return { names: new Map(), error: "Facebook isn't connected yet." };
  }

  // Addressed to /me, never to the saved Page ID. A token knows which Page
  // it belongs to; a hand-typed ID in a settings box is one fat finger away
  // from "Object with ID '…' does not exist", which is what was happening —
  // replies sent fine because sending already went through /me, while every
  // read addressed to /{page-id} failed.
  const identity = await getPageIdentity();

  const names = new Map<string, string>();
  let url: string | undefined = `${GRAPH}/me/conversations`;
  let params: Record<string, string> | undefined = {
    platform: "messenger",
    fields: "participants",
    limit: "100",
    access_token: config.pageAccessToken,
  };

  for (let page = 0; page < maxPages && url; page += 1) {
    try {
      const { data }: { data: InboxPage } = await axios.get(url, { params, timeout: 12000 });

      for (const thread of data.data ?? []) {
        for (const person of thread.participants?.data ?? []) {
          // The Page itself is a participant in every thread. Skip it.
          if (!person.id || person.id === identity?.id) continue;
          if (person.name?.trim()) names.set(person.id, person.name.trim());
        }
      }

      // paging.next is a fully-formed URL with the token already on it.
      url = data.paging?.next;
      params = undefined;
    } catch (error) {
      const err = error as { response?: { status?: number; data?: unknown } };
      const detail = err.response
        ? `conversations → HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 240)}`
        : `conversations → ${(error as Error).message}`;
      console.error(`[Facebook] Inbox list failed — ${detail}`);
      return { names, error: detail };
    }
  }

  return { names };
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

export async function resolveCustomerName(psid: string): Promise<string | undefined> {
  const profile = await getSenderProfile(psid);
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
