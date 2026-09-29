// Builds the pretend data for the test-drive build of the app (vite.demo.config.ts).
//
// Rather than hand-write what every screen expects, this seeds a throwaway
// database with an invented studio day, boots the real server against it and
// records the real answers to every query the screens make. The demo then
// replays them, so its data is the exact shape the live app gets — when the
// server changes, re-run this and the demo follows.
//
//   npm run build && node scripts/demo-fixtures.mjs
//
// Needs the same local MariaDB as tests/ (ci / ci on 127.0.0.1). The people
// are invented; no City Ink customer is in here.
import fs from "node:fs";
import { spawn } from "node:child_process";

process.env.TZ = "UTC";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ADMIN = process.env.DATABASE_URL || "mysql://ci:ci@127.0.0.1:3306/cityink";
const DB = ADMIN.replace(/\/[^/]*$/, "/runnit_demo");
const PORT = 5600 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = "demo-claim-code";
const OUT = `${ROOT}/src/client/demo/fixtures.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mysql = (await import(`${ROOT}/node_modules/mysql2/promise.js`)).default;
const admin = await mysql.createConnection(ADMIN);
await admin.query("DROP DATABASE IF EXISTS runnit_demo");
await admin.query("CREATE DATABASE runnit_demo");
await admin.end();

async function boot() {
  const server = spawn("node", ["dist/server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env, TZ: "UTC", PORT: String(PORT), DATABASE_URL: DB, NODE_ENV: "production",
      // Nowhere real: a demo must never be able to reach Meta or a model.
      FACEBOOK_GRAPH_URL: "http://127.0.0.1:1", LLM_BASE_URL: "http://127.0.0.1:1",
      LLM_PROVIDER: "anthropic", LLM_API_KEY: "sk-demo", LLM_MODEL: "claude-sonnet-5",
      STUDIO_CLAIM_CODE: CODE, PUBLIC_SIGNUP: "", DASHBOARD_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 80 && !/Schema ready/.test(log); i++) await sleep(250);
  return server;
}

let server = await boot();
server.kill();
await sleep(500);

const sql = await mysql.createConnection(DB);
await sql.query(
  `INSERT INTO facebook_config (page_id, page_name, page_access_token, app_id, app_secret, webhook_verify_token, is_configured)
   VALUES ('P1', 'City Ink Tattoo', 'demo', 'demo', 'demo', 'demo', 1)`
);
await sql.query(
  "INSERT INTO timely_config (booking_page_url, calendar_ics_url, is_configured) VALUES ('https://example.com/book', 'https://calendar.example.com/demo.ics', 1)"
);

const ago = (minutes) => new Date(Date.now() - minutes * 60_000);
let messageId = 0;
async function thread(id, name, platform, msgs) {
  const last = msgs[msgs.length - 1];
  const lastCustomer = [...msgs].reverse().find((m) => m.who === "customer");
  await sql.query(
    "INSERT INTO messenger_conversations (conversation_id, sender_name, platform, last_message_at, last_customer_message_at, created_at) VALUES (?,?,?,?,?,?)",
    [id, name, platform, ago(last.m), lastCustomer ? ago(lastCustomer.m) : null, ago(msgs[0].m)]
  );
  for (const m of msgs) {
    messageId++;
    await sql.query(
      "INSERT INTO messenger_messages (conversation_id, message_id, sender_type, content, created_at) VALUES (?,?,?,?,?)",
      [id, `${id}_${messageId}`, m.who, m.text, ago(m.m)]
    );
    m.id = `${id}_${messageId}`;
  }
  return msgs;
}
async function draft(conversationId, answering, text, minutes, extra = {}) {
  await sql.query(
    "INSERT INTO pending_replies (conversation_id, customer_message_id, draft_text, status, is_sensitive, alternatives, created_at) VALUES (?,?,?,'pending',?,?,?)",
    [conversationId, answering, text, extra.sensitive ? 1 : 0, extra.alternatives ? JSON.stringify(extra.alternatives) : null, ago(minutes)]
  );
}

const mia = await thread("demo_mia", "Mia Rose", "instagram", [
  { who: "customer", text: "hey! how much for a small fine line rose on my wrist?", m: 4 },
]);
await draft("demo_mia", mia[0].id, "Hey Mia! Fine line is Rina's favourite. Send us a pic of your wrist and roughly how big you'd like it, and we'll get you a quote and her next free spots.", 3, {
  alternatives: [{ label: "Short and sweet", text: "Hey Mia! Send a pic of your wrist and the size you're after and we'll quote you 😊" }],
});

const josh = await thread("demo_josh", "Josh Kay", "facebook", [
  { who: "customer", text: "Hi, I'm booked in Thursday for my sleeve", m: 60 * 26 },
  { who: "bot", text: "Hey Josh, yep — Thursday 10am with Kade. See you then!", m: 60 * 25 },
  { who: "customer", text: "Can I move Thursday to the weekend? Work's come up", m: 12 },
]);
await draft("demo_josh", josh[2].id, "No stress Josh. Kade has Saturday 10am or Sunday 1:30pm — which suits? Your deposit moves across with you.", 11);

const priya = await thread("demo_priya", "Priya Sen", "instagram", [
  { who: "customer", text: "I've had a really rough week and I need to cancel Friday, sorry", m: 30 },
]);
await draft("demo_priya", priya[0].id, "Thanks for letting us know, Priya.", 29, { sensitive: true });

const zac = await thread("demo_zac", "Zac Tran", "instagram", [
  { who: "customer", text: "Do you do cover-ups? I've got an old tribal piece on my shoulder", m: 45 },
]);
await draft("demo_zac", zac[0].id, "We do! Send a clear photo of it in daylight and we'll let you know what's possible and who'd be best for it.", 44);

await thread("demo_sam", "Sam Nguyen", "instagram", [
  { who: "customer", text: "are you guys open sunday?", m: 60 * 24 * 3 },
]);
await thread("demo_ella", "Ella Brooks", "instagram", [
  { who: "customer", text: "What should I do before my appointment tomorrow?", m: 60 * 20 },
  { who: "bot", text: "Eat a good meal, drink plenty of water and get a decent sleep. Wear something that shows the spot easily. See you at 10!", m: 60 * 19 },
  { who: "customer", text: "Perfect thank you!!", m: 60 * 19 - 5 },
  { who: "bot", text: "No worries 🖤", m: 60 * 19 - 8 },
]);
await thread("demo_noah", "Noah West", "facebook", [
  { who: "customer", text: "Keen to get a blackwork dagger on my forearm, about 15cm", m: 60 * 50 },
  { who: "bot", text: "Love it. Tomo is our blackwork guy — he's free Friday at 12. Want me to lock it in? A deposit holds the spot.", m: 60 * 49 },
  { who: "customer", text: "Yes please!", m: 60 * 48 },
  { who: "bot", text: "Done — Friday 12pm with Tomo. We'll send a reminder the day before.", m: 60 * 48 - 3 },
]);
await thread("demo_chloe", "Chloe Hart", "instagram", [
  { who: "customer", text: "My new piece is a bit shiny and itchy, is that normal?", m: 60 * 70 },
  { who: "bot", text: "Totally normal at this stage — it's healing. Keep it clean, a thin layer of balm, and try not to scratch. Send a pic if it gets hot or swollen.", m: 60 * 69 },
]);

const hours = (h) => new Date(Date.now() + h * 3600_000);
await sql.query(
  "INSERT INTO scheduled_posts (content, image_url, scheduled_at, status) VALUES (?,?,?,'scheduled'), (?,?,?,'scheduled'), (?,?,?,'scheduled'), (?,?,?,'published')",
  [
    "Healed and still this crisp. Fine line rose by Rina, six weeks on. She has spots from Monday — DM us to grab one.", "demo/work-rose.jpg", hours(9),
    "Two pieces, one very happy client. Done this week at City Ink.", "demo/work-face.jpg", hours(33),
    "Sleeve progress with Tomo. Session three and it's coming together.", "demo/work-sleeve.jpg", hours(57),
    "Fresh forearm wrap from last week.", "demo/work-arms.jpg", ago(60 * 30),
  ]
);
await sql.query(
  "INSERT INTO auto_reply_rules (trigger_keywords, response_text, send_booking_link, is_active, priority) VALUES (?,?,1,1,1), (?,?,0,1,0)",
  [JSON.stringify(["book", "booking", "appointment"]), "You can book straight in here — pick the artist and a time that suits:", JSON.stringify(["hours", "open"]), "We're open Tuesday to Saturday, 10am to 6pm."]
);
await sql.query(
  "INSERT INTO studio_knowledge (question, answer, is_active) VALUES (?,?,1), (?,?,1)",
  ["Do you take deposits?", "Yes — a deposit holds every booking and comes off the final price.", "Do you do walk-ins?", "On flash days, yes. Otherwise it's by appointment."]
);

server = await boot();
let cookie = "";
{
  const res = await fetch(`${BASE}/api/trpc/account.signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Brad Gibbons", email: "brad@example.com", password: "password123", code: CODE }),
  });
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    if (pair.startsWith("runnit_session=")) cookie = pair.slice("runnit_session=".length);
  }
  if (!cookie) throw new Error(`couldn't claim the demo studio: ${res.status} ${await res.text()}`);
}
await sql.query("UPDATE users SET onboarding_completed_at = NOW()");
await sql.query("UPDATE studios SET theme = 'ink', mode = NULL");

async function query(path, input) {
  const qs = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(`${BASE}/api/trpc/${path}${qs}`, { headers: { cookie: `runnit_session=${cookie}` } });
  const json = await res.json();
  if (json.error) throw new Error(`${path}: ${JSON.stringify(json.error).slice(0, 200)}`);
  return json.result?.data ?? null;
}

const fixtures = { capturedAt: new Date().toISOString(), queries: {}, messages: {} };
for (const path of [
  "account.me", "dashboard", "stats", "llm.status", "feed.list", "feed.count", "uploads.countToday",
  "conversations.list", "pendingReplies.list", "autoReply.getRules", "posts.getScheduled", "push.key", "push.status",
  "knowledge.list", "history.count", "history.edits", "config.facebook", "config.messengerDelivery", "config.timely",
  "config.reviewUrl",
]) {
  fixtures.queries[path] = await query(path);
}
fixtures.queries["uploads.list"] = await query("uploads.list", { unusedOnly: false });
fixtures.queries["search.sample"] = await query("search", { query: "rose" });
for (const c of fixtures.queries["conversations.list"]) {
  fixtures.messages[c.conversationId] = await query("conversations.messages", { conversationId: c.conversationId });
}

server.kill();
await sql.end();
fs.writeFileSync(OUT, JSON.stringify(fixtures, null, 1));
console.log(`wrote ${OUT}: ${Object.keys(fixtures.queries).length} queries, ${Object.keys(fixtures.messages).length} threads`);
process.exit(0);
