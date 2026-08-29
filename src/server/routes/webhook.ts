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

/**
 * What a non-photo attachment was, in words the studio can read on a card.
 *
 * A shared link keeps its URL, because for a tattoo enquiry the link the
 * customer sent IS the reference — dropping it loses the whole message.
 */
function describeAttachments(
  attachments: { type?: string; payload?: { url?: string } }[]
): string {
  const noun: Record<string, string> = {
    video: "a video",
    audio: "a voice message",
    file: "a file",
    location: "their location",
    fallback: "a link",
    template: "a link",
  };

  return attachments
    .map((a) => {
      const what = noun[a.type ?? ""] ?? "an attachment";
      const url = a.payload?.url;
      return url ? `(sent ${what}: ${url})` : `(sent ${what})`;
    })
    .join(" ");
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

          const attachments: { type?: string; payload?: { url?: string } }[] =
            message.attachments ?? [];

          const photoUrls: string[] = attachments
            .filter((a) => a.type === "image")
            .map((a) => a.payload?.url)
            .filter((url: string | undefined): url is string => !!url);

          /**
           * Everything that isn't a photo.
           *
           * Only images were ever looked at, and a message with no text and
           * no image was dropped here without a trace. Sharing an Instagram
           * post of a tattoo you like arrives as "fallback" with no text at
           * all — which is one of the commonest ways a customer says what
           * they want, and it was vanishing before it reached the inbox.
           * Nothing a customer sends should disappear silently; if we can't
           * show it, we can at least say it arrived.
           */
          const others = attachments.filter((a) => a.type !== "image");

          if (!event.sender?.id) return;
          if (!message.text && !photoUrls.length && !others.length) return;

          const describedOther = others.length ? describeAttachments(others) : "";

          await handleCustomerMessage(
            event.sender.id,
            message.mid ?? `msg_${Date.now()}`,
            // A shared link carries its URL in the payload — worth keeping,
            // because for a tattoo enquiry that link IS the reference.
            [message.text, describedOther].filter(Boolean).join(" ").trim(),
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
