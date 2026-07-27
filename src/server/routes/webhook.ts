import { Router, type Request, type Response } from "express";
import { verifyWebhookSignature } from "../facebook.js";
import { handleCustomerMessage, handleEcho } from "../agent.js";
import { getFacebookConfig } from "../db.js";

const router = Router();

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

  if (req.body?.object !== "page") return;

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
            photoUrls
          );
        } catch (error) {
          console.error("[Webhook] Processing failed:", (error as Error).message);
        }
      })();
    }
  }
});

export default router;
