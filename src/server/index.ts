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
import { readAttachment } from "./attachments.js";
import { saveArtistUpload, readArtistUpload, UploadRejected } from "./uploads.js";
import { syncFeed, countFeed } from "./feed.js";
import QRCode from "qrcode";
import { getLastLlmError, llmProvider, llmModel, llmBaseUrl } from "./llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

const app = express();

/**
 * BUG FIX #1 (the other half) — Facebook signs the exact bytes it sends.
 * This keeps a copy of them before the JSON parser touches anything.
 */
app.use(
  express.json({
    limit: "5mb",
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.use("/api/webhook", webhookRouter);

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

app.get("/api/uploads/:id", async (req, res) => {
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
app.get("/api/upload-qr.png", async (req, res) => {
  try {
    const origin = `${req.protocol}://${req.get("host")}`;
    const png = await QRCode.toBuffer(`${origin}/upload`, {
      width: 720,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#2B2622", light: "#FFFFFF" },
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.end(png);
  } catch (error) {
    console.error("[Uploads] QR failed:", (error as Error).message);
    return res.sendStatus(500);
  }
});

// Reference photos, served from our own copy rather than Facebook's CDN —
// their links expire, ours don't. Content-addressed, so it can be cached
// hard: the same path always means the same image.
app.get("/api/attachments/:id", async (req, res) => {
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

  startScheduler();
});
