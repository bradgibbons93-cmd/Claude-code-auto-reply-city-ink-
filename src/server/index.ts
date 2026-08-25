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
import { backfillCustomerNames } from "./facebook.js";
import { readAttachment } from "./attachments.js";
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

  startScheduler();
});
