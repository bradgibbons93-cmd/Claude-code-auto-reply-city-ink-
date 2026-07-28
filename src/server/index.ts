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
import { getLastLlmError } from "./llm.js";

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
    llmProvider: process.env.LLM_PROVIDER || "anthropic",
    llmKeySet: !!process.env.LLM_API_KEY,
    llmModel: process.env.LLM_MODEL || "(default)",
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

  startScheduler();
});
