import { Router, type Request, type Response } from "express";
import { verifyWebhookSignature } from "../facebook.js";
import { handleCustomerMessage, handleEcho } from "../agent.js";
import {
  getFacebookConfig,
  recordWebhookDelivery,
  recordWebhookRejection,
  clearWebhookRejections,
} from "../db.js";

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

/** In memory for this process, and in the database so a deploy can't forget. */
function noteDelivery(kind: string): void {
  lastDelivery = { at: new Date().toISOString(), kind };
  // Say so. Only failures were ever logged, so a webhook that worked and one
  // that was being silently refused produced the same empty log — which is
  // most of why a day went into finding out which was happening.
  console.log(`[Webhook] Accepted a ${kind} delivery from Facebook`);
  void recordWebhookDelivery(kind);
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
    noteDelivery("verification");
    console.log("[Webhook] Verified by Facebook");
    return res.status(200).send(challenge);
  }

  console.warn("[Webhook] Verification failed");
  return res.sendStatus(403);
});

router.post("/facebook", async (req: RawBodyRequest, res: Response) => {
  const config = await getFacebookConfig().catch(() => undefined);

  if (config?.appSecret) {
    const raw = req.rawBody ?? Buffer.alloc(0);
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    /**
     * Two secrets, because Meta uses two.
     *
     * Every rejected delivery in the logs was object=instagram, several
     * carrying real DMs, while not one Messenger delivery was ever refused —
     * Messenger simply had nothing to send. Instagram signs its webhooks with
     * the Instagram product's own app secret, which is a different value from
     * the Facebook app secret even inside a single Meta app. Checking
     * Instagram deliveries against the Facebook secret refused every DM the
     * studio received, for days, silently.
     *
     * Both are the studio's own credentials, so accepting a delivery that
     * matches either is not a loosening: a forged one still matches neither.
     * Trimmed, because a pasted secret picks up whitespace easily and every
     * other use of it tolerates that while an HMAC does not.
     */
    const secrets = [config.appSecret, config.instagramAppSecret]
      .map((secret) => secret?.trim())
      .filter((secret): secret is string => !!secret);
    const ok = secrets.some((secret) => verifyWebhookSignature(raw, signature, secret));
    if (!ok) {
      // Never accept it — the signature is what proves this came from Meta.
      // But record it, loudly. Silently 403-ing real customer messages while
      // the dashboard reported zero and every other panel looked healthy is
      // how a whole day's enquiries went missing without anyone knowing.
      /**
       * Say enough to tell the two causes apart next time.
       *
       * A wrong secret and a right secret with a stray character look
       * identical from here, and guessing between them cost a day. So report
       * whether the untrimmed form would have matched, and what kind of
       * delivery this was — dozens of rejections an hour is alarming if they
       * are customer messages and merely noisy if they are read receipts.
       *
       * The body is unverified, so it is described, never acted on.
       */
      // Worked out before recording, so the settings page can show it.
      const untrimmedWouldMatch =
        config.appSecret !== config.appSecret.trim() &&
        verifyWebhookSignature(raw, signature, config.appSecret);
      const kind = typeof req.body?.object === "string" ? req.body.object : "unknown";
      // An Instagram delivery refused while no Instagram secret is saved is a
      // missing setting, not a wrong one, and it has its own answer.
      const needsInstagramSecret = kind === "instagram" && !config.instagramAppSecret;
      const carriesMessage = JSON.stringify(req.body ?? {}).includes('"message"');
      console.warn(
        `[Webhook] Rejected: bad signature — object=${kind} ` +
          `carriesMessage=${carriesMessage} untrimmedWouldMatch=${untrimmedWouldMatch}. ` +
          "The saved App secret doesn't match the one Facebook is signing with."
      );
      void recordWebhookRejection(
        needsInstagramSecret
          ? "These are Instagram DMs. Instagram signs them with the Instagram app secret, " +
            "which is a different value from the Facebook one — paste it in below."
          : `object=${kind}, carries a message=${carriesMessage}, ` +
            `whitespace was the cause=${untrimmedWouldMatch}`
      );
      return res.sendStatus(403);
    }
    // Accepted. Whatever was wrong before is over.
    void clearWebhookRejections();
  }

  /**
   * BUG FIX #2 — the original awaited the whole AI round-trip before
   * answering Facebook. Facebook gives you ~20 seconds, then retries, and
   * the customer gets the same reply two or three times. Acknowledge first,
   * work afterwards.
   */
  res.sendStatus(200);

  noteDelivery(req.body?.object ?? "unknown");

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
