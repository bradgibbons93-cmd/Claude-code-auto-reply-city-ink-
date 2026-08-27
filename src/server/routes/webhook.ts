import { Router, type Request, type Response } from "express";
import { verifyWebhookSignature } from "../facebook.js";
import { handleCustomerMessage, handleEcho } from "../agent.js";
import { getFacebookConfig } from "../db.js";

const router = Router();

/**
 * When Facebook last sent us anything at all.
 *
 * "It isn't pulling messages in" has two very different causes — Facebook
 * never delivering, or us mishandling what arrives — and they need opposite
 * fixes. Nothing in the app could tell them apart, so this records the last
 * delivery and the dashboard reports it.
 */
let lastDelivery: { at: string; kind: string } | null = null;
export function getLastWebhookDelivery() {
  return lastDelivery;
}

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

router.get("/facebook", async (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const config = await getFacebookConfig().catch(() => undefined);
  const expected = config?.webhookVerifyToken || process.env.VERIFY_TOKEN;

  if (mode === "subscribe" && token && token === expected && challenge) {
    lastDelivery = { at: new Date().toISOString(), kind: "verification" };
    console.log("[Webhook] Verified by Facebook");
    return res.status(200).send(challenge);
  }

  console.warn("[Webhook] Verification failed");
  return res.sendStatus(403);
});

router.post("/facebook", async (req: RawBodyRequest, res: Response) => {
  const config = await getFacebookConfig().catch(() => undefined);

  if (config?.appSecret) {
    const ok = verifyWebhookSignature(
      req.rawBody ?? Buffer.alloc(0),
      req.headers["x-hub-signature-256"] as string | undefined,
      config.appSecret
    );
    if (!ok) {
      console.warn("[Webhook] Rejected: bad signature");
      return res.sendStatus(403);
    }
  }

  /**
   * BUG FIX #2 — the original awaited the whole AI round-trip before
   * answering Facebook. Facebook gives you ~20 seconds, then retries, and
   * the customer gets the same reply two or three times. Acknowledge first,
   * work afterwards.
   */
  res.sendStatus(200);

  lastDelivery = { at: new Date().toISOString(), kind: req.body?.object ?? "unknown" };

  /**
   * "page" is Messenger. "instagram" is Instagram DMs — a separate webhook
   * object with an identical messaging payload, which is why only half the
   * studio's enquiries were arriving: every Messenger thread came through
   * and every Instagram one was dropped on this line.
   */
  const platform: "facebook" | "instagram" | null =
    req.body?.object === "page"
      ? "facebook"
      : req.body?.object === "instagram"
        ? "instagram"
        : null;
  if (!platform) return;

  for (const entry of req.body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const message = event.message;
      if (!message) continue;

      void (async () => {
        try {
          if (message.is_echo) {
            await handleEcho(
              event.recipient?.id,
              message.mid ?? `echo_${Date.now()}`,
              message.text ?? "",
              message.app_id
            );
            return;
          }

          const photoUrls: string[] = (message.attachments ?? [])
            .filter((a: { type?: string }) => a.type === "image")
            .map((a: { payload?: { url?: string } }) => a.payload?.url)
            .filter((url: string | undefined): url is string => !!url);

          if (!event.sender?.id || (!message.text && !photoUrls.length)) return;

          await handleCustomerMessage(
            event.sender.id,
            message.mid ?? `msg_${Date.now()}`,
            message.text ?? "",
            photoUrls,
            platform
          );
        } catch (error) {
          console.error("[Webhook] Processing failed:", (error as Error).message);
        }
      })();
    }
  }
});

export default router;
