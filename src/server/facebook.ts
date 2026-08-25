import crypto from "node:crypto";
import axios from "axios";
import {
  getFacebookConfig,
  getConversationsMissingNames,
  setConversationName,
} from "./db.js";

const GRAPH = "https://graph.facebook.com/v21.0";

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
 * Go and get the names for threads that are already in the database.
 *
 * Filling a name in as the next message arrives fixes nothing for a thread
 * whose last message was hours ago — it just sits there saying "a customer"
 * forever. This walks the nameless ones and asks Facebook for each.
 *
 * Runs on boot and behind a button, and always reports back: how many were
 * missing, how many were resolved, and — if none were — Facebook's own words
 * for why, so the answer isn't "it's still not working".
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

  let named = 0;
  for (const conversationId of missing) {
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
      detail: `Named ${named} of ${missing.length}. The rest: ${lastProfileError?.message ?? "no name available"}`,
    };
  }
  return {
    checked: missing.length,
    named: 0,
    detail: `Facebook wouldn't give a name for any of the ${missing.length}. It said: ${
      lastProfileError?.message ?? "no name available"
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
