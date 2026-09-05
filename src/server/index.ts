import "dotenv/config";
import express, { type Request } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers.js";
import webhookRouter from "./routes/webhook.js";
import { startScheduler } from "./scheduler.js";
import { ensureTables } from "./migrate.js";
import { getFacebookConfig, getTimelyConfig } from "./db.js";
import { backfillCustomerNames, ensureMessengerSubscription } from "./facebook.js";
import { readAttachment, saveImageBytes, UnsupportedImage } from "./attachments.js";
import { saveArtistUpload, readArtistUpload, UploadRejected } from "./uploads.js";
import { syncFeed, countFeed } from "./feed.js";
import QRCode from "qrcode";
import { getLastLlmError, llmProvider, llmModel, llmBaseUrl, reportModelAvailability } from "./llm.js";
import { reportPushReadiness } from "./push.js";
import { reportAppIdentity } from "./token.js";
import { mountAuth, requireStudio, requireStudioOrSignedLink } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

const app = express();

/**
 * BUG FIX #1 (the other half) — Facebook signs the exact bytes it sends.
 * This keeps a copy of them before the JSON parser touches anything.
 */
const globalJson = express.json({
  limit: "5mb",
  verify: (req, _res, buf) => {
    (req as RawBodyRequest).rawBody = buf;
  },
});

/**
 * The two photo routes below set their own, much larger, body limit — and
 * until now they never got to use it. The parser above used to be mounted on
 * everything, so a photo over about 3.7MB (5MB once it is base64) was refused
 * here with Express's own HTML "Payload Too Large" page, before the route
 * with the 24MB limit was ever reached. An artist photographing a piece
 * on any recent phone was hitting that every time, and the message the code
 * apologises with — "that photo is over 8MB" — was never the reason.
 *
 * So those two paths are stepped over, and keep the limit they declare.
 */
const PHOTO_ROUTES = new Set(["/api/uploads", "/api/post-image"]);
app.use((req, res, next) => {
  if (PHOTO_ROUTES.has(req.path)) return next();
  return globalJson(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// Before the guard: Meta has to be able to reach the webhook, and the
// browser has to be able to ask whether a password is even set.
app.use("/api/webhook", webhookRouter);
mountAuth(app);

/**
 * Artists' end-of-day photos.
 *
 * Deliberately open — the artists reach it by scanning a QR code on the wall,
 * and putting a login in front of that guarantees it never gets used. It only
 * ever accepts an image and only ever adds to the grid; nothing here can read
 * a conversation, send a message, or change a setting.
 *
 * Its own body limit, because a phone photo is far bigger than a webhook and
 * raising the global limit for one route would be the wrong trade.
 */
app.post("/api/uploads", express.json({ limit: "24mb" }), async (req, res) => {
  try {
    const { artistName, note, photos } = req.body ?? {};
    if (!Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ error: "Pick at least one photo." });
    }
    if (photos.length > 20) {
      return res.status(400).json({ error: "Twenty photos at a time, max." });
    }

    const saved: string[] = [];
    const rejected: string[] = [];
    for (const photo of photos) {
      const base64 = String(photo?.dataUrl ?? "").split(",")[1] ?? "";
      try {
        const { id } = await saveArtistUpload({
          artistName,
          note,
          contentType: String(photo?.contentType ?? ""),
          bytes: Buffer.from(base64, "base64"),
        });
        saved.push(id);
      } catch (error) {
        if (error instanceof UploadRejected) rejected.push(error.message);
        else throw error;
      }
    }

    console.log(`[Uploads] ${saved.length} photo(s) from ${artistName || "an artist"}`);
    return res.json({ saved: saved.length, rejected });
  } catch (error) {
    console.error("[Uploads] Save failed:", (error as Error).message);
    return res.status(500).json({ error: "Couldn't save those — try again in a moment." });
  }
});

/**
 * A gallery photo. Studio-only, or a link the publisher signed.
 *
 * The signed variant matters because these are now postable: Facebook comes
 * and collects the picture itself, with no cookie, so behind a password
 * every bulk-scheduled post would have failed on Facebook's side of the
 * fetch — invisibly, the same way the attachments route did.
 */
app.get<{ id: string }>("/api/uploads/:id", requireStudioOrSignedLink, async (req, res) => {
  try {
    const upload = await readArtistUpload(req.params.id);
    if (!upload) return res.sendStatus(404);
    res.setHeader("Content-Type", upload.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.end(upload.bytes);
  } catch (error) {
    console.error("[Uploads] Serve failed:", (error as Error).message);
    return res.sendStatus(500);
  }
});

/**
 * The QR code the artists scan, as a PNG. Generated here rather than in the
 * browser so it can be printed straight from the page, and so the URL it
 * encodes is the one the server actually answers on.
 */
app.get("/api/upload-qr.png", requireStudio, async (req, res) => {
  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    const png = await QRCode.toBuffer(`${origin}/upload`, {
      width: 720,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#6F5A4B", light: "#FFFFFF" },
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.end(png);
  } catch (error) {
    console.error("[Uploads] QR failed:", (error as Error).message);
    return res.sendStatus(500);
  }
});

/**
 * A photo for a scheduled post, straight off the studio's phone.
 *
 * Asking for an image URL meant the picture had to already be on the
 * internet somewhere, which for a photo just taken on a phone it never is.
 * Its own generous body limit for the same reason as the artist uploads.
 */
app.post("/api/post-image", requireStudio, express.json({ limit: "24mb" }), async (req, res) => {
  try {
    const { contentType, dataUrl } = req.body ?? {};
    const base64 = String(dataUrl ?? "").split(",")[1] ?? "";
    const { url } = await saveImageBytes(
      String(contentType ?? ""),
      Buffer.from(base64, "base64"),
      "post"
    );
    return res.json({ url });
  } catch (error) {
    if (error instanceof UnsupportedImage) {
      return res.status(400).json({ error: error.message });
    }
    console.error("[Posts] Image upload failed:", (error as Error).message);
    return res.status(500).json({ error: "Couldn't save that photo — try again in a moment." });
  }
});

// Reference photos, served from our own copy rather than Facebook's CDN —
// their links expire, ours don't. Content-addressed, so it can be cached
// hard: the same path always means the same image.
// Customers' own reference photos, and the pictures on scheduled posts.
// Studio-only, except for a link the publisher signed so Facebook's servers
// can come and collect the one image they're about to post.
app.get<{ id: string }>("/api/attachments/:id", requireStudioOrSignedLink, async (req, res) => {
  try {
    const attachment = await readAttachment(req.params.id);
    if (!attachment) return res.sendStatus(404);
    res.setHeader("Content-Type", attachment.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.end(attachment.bytes);
  } catch (error) {
    console.error("[Attachments] Serve failed:", (error as Error).message);
    return res.sendStatus(500);
  }
});

app.use(
  "/api/trpc",
  // Everything the studio can read or change goes through here.
  requireStudio,
  createExpressMiddleware({
    router: appRouter,
    onError({ error, path: procPath }) {
      console.error(`[tRPC] ${procPath}:`, error.message);
    },
  })
);

app.get("/health", async (_req, res) => {
  const fb = await getFacebookConfig().catch(() => undefined);
  const timely = await getTimelyConfig().catch(() => undefined);
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    facebookConnected: !!fb?.isConfigured,
    bookingLinkSet: !!timely?.bookingPageUrl,
    llmProvider: llmProvider(),
    llmKeySet: !!process.env.LLM_API_KEY,
    llmModel: llmModel(),
    llmBaseUrl: llmBaseUrl(),
    // Whatever the model last rejected — an invalid key or spent credit
    // shows up here rather than only in the logs.
    lastLlmError: getLastLlmError(),
    calendarConnected: !!timely?.calendarIcsUrl,
  });
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../../dist/client");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

const port = Number(process.env.PORT || 3000);

app.listen(port, async () => {
  console.log(`\n  City Ink agent listening on http://localhost:${port}`);
  console.log(`  Webhook:  /api/webhook/facebook`);
  console.log(`  Health:   /health\n`);

  // Without this the first save from Settings hits tables that don't exist.
  // A failure here shouldn't take the server down — log it and carry on, so
  // the dashboard still loads and /health can report what's wrong.
  try {
    await ensureTables();
  } catch (error) {
    console.error("[DB] Could not prepare schema:", (error as Error).message);
  }

  // Threads that arrived before the name lookup worked never get revisited
  // by a webhook — nothing new is coming in on them. Repair them on the way
  // up so the dashboard isn't a wall of "a customer".
  backfillCustomerNames()
    .then(({ checked, named, detail }) => {
      if (checked > 0) console.log(`[Facebook] Name backfill: ${named}/${checked} — ${detail}`);
    })
    .catch((error) => console.error("[Facebook] Name backfill failed:", (error as Error).message));

  // Put the Messenger subscription back if an outage cost us it. This is
  // exactly what happened: the service was down for a day, Facebook gave up
  // delivering, and coming back online didn't restore the subscription — the
  // app looked healthy and received nothing.
  ensureMessengerSubscription()
    .then(({ action, detail }) => {
      if (action !== "none") console.log(`[Facebook] Messenger subscription ${action} — ${detail}`);
    })
    .catch((error) =>
      console.error("[Facebook] Subscription check failed:", (error as Error).message)
    );

  // Fill the feed in on the way up if it's empty — the first thing anyone
  // wants to see is the last few months, not an empty panel that fills in
  // slowly over the coming weeks.
  countFeed()
    .then((count) => (count === 0 ? syncFeed() : undefined))
    .catch((error) => console.error("[Feed] Backfill failed:", (error as Error).message));

  // Say now whether the configured model is one this key can actually use.
  // Finding that out from an empty draft box with a customer waiting is how
  // it went the first time.
  reportModelAvailability().catch(() => undefined);

  // And whether a notification could reach anyone at all. A customer wrote in,
  // a draft was written, and the phone stayed silent — findable afterwards
  // only by the absence of a log line, which is no way to find anything.
  reportPushReadiness().catch(() => undefined);

  // And which Meta app the saved Page token actually belongs to. This studio
  // has two apps; permissions and App Review belong to one of them, and a
  // token from the wrong one looks perfectly healthy while never receiving
  // the approval being waited on.
  getFacebookConfig()
    .then((c) => reportAppIdentity(c?.pageAccessToken, c?.appId, c?.appSecret))
    .catch(() => undefined);

  startScheduler();
});
