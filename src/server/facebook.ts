import crypto from "node:crypto";
import axios from "axios";
import {
  getFacebookConfig,
  getConversationsMissingNames,
  setConversationName,
} from "./db.js";

// Overridable so the whole thing can be run end to end against a stand-in
// Graph API. Unset everywhere except a test run, which is the only way to
// watch a real page render a real name without messaging the studio.
const GRAPH = process.env.FACEBOOK_GRAPH_URL || "https://graph.facebook.com/v21.0";

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
  if (!config?.pageAccessToken || !config.pageId) {
    return { names: new Map(), error: "Facebook isn't connected yet." };
  }

  const names = new Map<string, string>();
  let url: string | undefined = `${GRAPH}/${config.pageId}/conversations`;
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
          if (!person.id || person.id === config.pageId) continue;
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
  if (!config?.pageAccessToken || !config.pageId) {
    throw new Error("Facebook is not connected yet");
  }

  const endpoint = imageUrl
    ? `${GRAPH}/${config.pageId}/photos`
    : `${GRAPH}/${config.pageId}/feed`;

  const payload = imageUrl
    ? { url: imageUrl, caption: content, access_token: config.pageAccessToken }
    : { message: content, access_token: config.pageAccessToken };

  const { data } = await axios.post(endpoint, payload, { timeout: 30000 });
  return (data.post_id || data.id) as string;
}
