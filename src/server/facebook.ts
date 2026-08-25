import crypto from "node:crypto";
import axios from "axios";
import { getFacebookConfig } from "./db.js";

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

export async function getSenderProfile(
  senderId: string
): Promise<{ name?: string } | null> {
  const config = await getFacebookConfig();
  if (!config?.pageAccessToken) return null;
  try {
    const { data } = await axios.get(`${GRAPH}/${senderId}`, {
      params: { fields: "first_name,last_name", access_token: config.pageAccessToken },
      timeout: 8000,
    });
    const name = [data.first_name, data.last_name].filter(Boolean).join(" ");
    return { name: name || undefined };
  } catch (error) {
    // Swallowing this silently is why every customer showed as "Unknown".
    // Facebook refuses the profile lookup for its own reasons — usually a
    // permission the app hasn't been granted — and we need to see which.
    const err = error as { response?: { status?: number; data?: unknown } };
    const detail = err.response
      ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`
      : (error as Error).message;
    console.error(`[Facebook] Couldn't read the profile for ${senderId} — ${detail}`);
    return null;
  }
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
