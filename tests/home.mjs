// The Home screen Brad picked on 29 September — "Build it" — driven on a
// phone-sized browser against the real server and its own database.
//
// What has to hold, because a swipe is an approval and approvals reach real
// customers:
//   1. swiping a reply right sends it — but only after the Undo window, and
//      exactly once, through the same approve path as the inbox
//   2. Undo inside the window sends nothing and puts the card back
//   3. swiping left (or tapping) opens the conversation instead of sending
//   4. a draft that needs a person (something personal) can't be sent blind:
//      a right swipe opens the chat and Meta hears nothing
//   5. today's bookings, the post queue and the "waiting without a draft"
//      count read the real data; the bottom menu works on a phone and hides
//      on a laptop
//
// Runs on UTC, as Railway does. Screenshots go to SHOTS (default /tmp/home).
import http from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";

process.env.TZ = "UTC";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ADMIN = process.env.DATABASE_URL || "mysql://ci:ci@127.0.0.1:3306/cityink";
const DB = ADMIN.replace(/\/[^/]*$/, "/runnit_home");
const PORT = 4900 + Math.floor(Math.random() * 90);
const GRAPH = PORT + 100;
const MODEL = PORT + 200;
const ICS = PORT + 300;
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = "home-claim-code-42";
const SHOTS = process.env.SHOTS || "/tmp/home";
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- stand-ins ---------- */
// Meta: remembers every message the app tries to send.
const sent = [];
const graph = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && /\/me\/messages/.test(req.url)) {
      sent.push(JSON.parse(raw || "{}"));
      return res.end(JSON.stringify({ recipient_id: "x", message_id: `m_${sent.length}` }));
    }
    res.end(JSON.stringify({ data: [] }));
  });
});
await new Promise((r) => graph.listen(GRAPH, r));

const model = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify({ reply: "Thanks for getting in touch!", alternatives: [], intent: "other", sensitive: false }) }],
      stop_reason: "end_turn",
    }));
  });
});
await new Promise((r) => model.listen(MODEL, r));

// The booking calendar: something done earlier today, someone in the chair
// now, and someone later — all inside today on the studio's clock.
const zone = "Australia/Melbourne";
const wall = (d) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
};
const now = new Date();
const nowMin = wall(now).minutes;
const midnight = new Date(now.getTime() - nowMin * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds());
const endOfDay = new Date(midnight.getTime() + 24 * 3600_000);
const at = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const events = [];
if (nowMin > 60) events.push({ name: "Ella – fine line", start: new Date(midnight.getTime() + 5 * 60_000), end: new Date(midnight.getTime() + 35 * 60_000) });
events.push({
  name: "Noah – blackwork",
  start: new Date(Math.max(midnight.getTime(), now.getTime() - 20 * 60_000)),
  end: new Date(Math.min(endOfDay.getTime() - 60_000, now.getTime() + 20 * 60_000)),
});
if (endOfDay.getTime() - now.getTime() > 60 * 60_000)
  events.push({ name: "Priya – consult", start: new Date(now.getTime() + 30 * 60_000), end: new Date(now.getTime() + 45 * 60_000) });
const ics = http.createServer((req, res) => {
  res.setHeader("content-type", "text/calendar");
  res.end(
    [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//home test//EN",
      ...events.flatMap((e, i) => ["BEGIN:VEVENT", `UID:e${i}@test`, `DTSTAMP:${at(now)}`, `DTSTART:${at(e.start)}`, `DTEND:${at(e.end)}`, `SUMMARY:${e.name}`, "END:VEVENT"]),
      "END:VCALENDAR",
    ].join("\r\n")
  );
});
await new Promise((r) => ics.listen(ICS, r));

/* ---------- the server and its data ---------- */
const mysql = (await import(`${ROOT}/node_modules/mysql2/promise.js`)).default;
const admin = await mysql.createConnection(ADMIN);
await admin.query("DROP DATABASE IF EXISTS runnit_home");
await admin.query("CREATE DATABASE runnit_home");
await admin.end();

async function boot() {
  const server = spawn("node", ["dist/server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env, TZ: "UTC", PORT: String(PORT), DATABASE_URL: DB, NODE_ENV: "production",
      FACEBOOK_GRAPH_URL: `http://127.0.0.1:${GRAPH}`,
      LLM_PROVIDER: "anthropic", LLM_BASE_URL: `http://127.0.0.1:${MODEL}`, LLM_API_KEY: "sk-ant-test", LLM_MODEL: "claude-sonnet-5",
      STUDIO_CLAIM_CODE: CODE, PUBLIC_SIGNUP: "", DASHBOARD_PASSWORD: "", STUDIO_TIMEZONE: zone,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 80 && !/Schema ready/.test(log); i++) await sleep(250);
  return { server, log: () => log };
}

let run = await boot();
run.server.kill();
await sleep(500);

const sql = await mysql.createConnection(DB);
await sql.query(
  `INSERT INTO facebook_config (page_id, page_name, page_access_token, app_id, app_secret, webhook_verify_token, is_configured)
   VALUES ('P1', 'City Ink Tattoo', 'tok', 'app', 'secret', 'verify', 1)`
);
await sql.query(
  "INSERT INTO timely_config (booking_page_url, calendar_ics_url, is_configured) VALUES ('https://example.com/book', ?, 1)",
  [`http://127.0.0.1:${ICS}/cal.ics`]
);
const ago = (minutes) => new Date(Date.now() - minutes * 60_000);
async function thread(id, name, platform, text, minutes) {
  await sql.query(
    "INSERT INTO messenger_conversations (conversation_id, sender_name, platform, last_message_at, created_at) VALUES (?,?,?,?,?)",
    [id, name, platform, ago(minutes), ago(minutes)]
  );
  await sql.query(
    "INSERT INTO messenger_messages (conversation_id, message_id, sender_type, content, created_at) VALUES (?,?,?,?,?)",
    [id, `${id}_m1`, "customer", text, ago(minutes)]
  );
}
async function draft(id, text, minutes, sensitive = false) {
  await sql.query(
    "INSERT INTO pending_replies (conversation_id, customer_message_id, draft_text, status, is_sensitive, created_at) VALUES (?,?,?,'pending',?,?)",
    [id, `${id}_m1`, text, sensitive ? 1 : 0, ago(minutes)]
  );
}
await thread("mia", "Mia Rose", "instagram", "how much for a small fine line rose on my wrist?", 4);
await draft("mia", "Hey Mia! Send a pic of your wrist and roughly how big, and I'll get you a quote.", 3);
await thread("josh", "Josh Kay", "facebook", "Can I move Thursday to the weekend?", 12);
await draft("josh", "No stress Josh. Saturday 10:00 or Sunday 1:30 — which suits?", 11);
await thread("priya", "Priya Sen", "instagram", "I've had a really rough week and need to cancel", 30);
await draft("priya", "Thanks for letting us know.", 29, true);
// Waiting three days with no draft: outside the poll's 24-hour drafting
// range, inside Meta's reply window — the deck can't show them.
await thread("sam", "Sam Nguyen", "instagram", "are you open sunday?", 3 * 24 * 60);
const tomorrow = new Date(Date.now() + 26 * 3600_000);
await sql.query("INSERT INTO scheduled_posts (content, scheduled_at, status) VALUES ('Healed rose by Rina', ?, 'scheduled'), ('Flash day Saturday', ?, 'scheduled')", [tomorrow, new Date(tomorrow.getTime() + 3600_000)]);

run = await boot();

// Brad claims the studio and has finished setting up.
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
  check("the owner can claim the studio", res.status === 200 && !!cookie, `${res.status} ${await res.text()}`);
}
await sql.query("UPDATE users SET onboarding_completed_at = NOW()");
await sql.query("UPDATE studios SET theme = 'ink', mode = NULL");

const api = async (path) => {
  const res = await fetch(`${BASE}/api/trpc/${path}`, { headers: { cookie: `runnit_session=${cookie}` } });
  return (await res.json())?.result?.data;
};
const order = (await api("pendingReplies.list")).map((d) => d.conversationId);
check("three drafts on the board", order.length === 3, JSON.stringify(order));
const status = async (id) => (await sql.query("SELECT status FROM pending_replies WHERE conversation_id = ?", [id]))[0][0]?.status;

const { chromium } = await import(`${ROOT}/node_modules/playwright/index.mjs`);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const errors = [];

try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "no-preference" });
  await phone.addCookies([{ name: "runnit_session", value: cookie, url: BASE }]);
  const page = await phone.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: "load" });
  await page.getByText(/ready to send/i).waitFor({ timeout: 15000 }).catch(async (error) => {
    await page.screenshot({ path: `${SHOTS}/00-failed-to-load.png` });
    console.log("URL", page.url(), "\nBODY", (await page.locator("body").innerText()).slice(0, 600), "\nERRORS", errors.join(" | "));
    throw error;
  });
  await sleep(2500); // let the ink finish and the hint play
  await page.screenshot({ path: `${SHOTS}/01-phone-home.png` });
  await page.screenshot({ path: `${SHOTS}/01b-phone-home-full.png`, fullPage: true });

  const main = () => page.locator("main").innerText();
  check("the deck says how many replies are waiting", /3 ready to send/i.test(await main()), (await main()).slice(0, 200));
  check("and says the AI is live", /AI replies live/.test(await main()));

  const top = page.locator('article[aria-label^="Reply to"]');
  const drag = async (dx) => {
    const box = await top.boundingBox();
    const y = box.y + box.height / 2;
    const x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + (dx * i) / 8, y + i);
    await page.mouse.up();
  };
  const topName = async () => (await top.getAttribute("aria-label")).replace("Reply to ", "");
  const idFor = { "Mia Rose": "mia", "Josh Kay": "josh", "Priya Sen": "priya" };

  // Put the person who needs care last so the quick ones come first.
  // (The board's own order decides; if Priya is on top, deal with her first.)
  if ((await topName()) === "Priya Sen") {
    check("a personal message says so on the card", await page.getByText(/Something personal/).isVisible());
    check("and its button opens the chat instead of sending", await page.getByRole("button", { name: "Open chat" }).isVisible());
    await drag(170);
    await page.waitForURL(/\/messages\?thread=priya/, { timeout: 5000 }).catch(() => {});
    check("a right swipe on it opens the conversation", /thread=priya/.test(page.url()), page.url());
    await page.goto(BASE, { waitUntil: "load" });
    await page.getByText(/ready to send/i).waitFor();
  }

  // 1. Swipe right: nothing for five seconds, then exactly one send.
  const first = await topName();
  const firstId = idFor[first];
  check("the top card shows what they asked", await top.getByText(/“.+”/).first().isVisible());
  await drag(180);
  await page.getByText(new RegExp(`Sending to ${first}`)).waitFor({ timeout: 4000 });
  check("a swipe right offers Undo before anything goes", await page.getByRole("button", { name: "Undo" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/02-phone-sending.png` });
  await sleep(1500);
  check("and Meta has heard nothing yet", sent.length === 0, JSON.stringify(sent));
  check("the card has left the deck", /2 ready to send/i.test(await main()), (await main()).slice(0, 120));
  await sleep(5500);
  check("after the window it is sent, once", sent.length === 1, JSON.stringify(sent));
  const expected = (await sql.query("SELECT draft_text FROM pending_replies WHERE conversation_id = ?", [firstId]))[0][0].draft_text;
  check("with the draft's words", sent[0]?.message?.text === expected, JSON.stringify(sent[0]));
  check("and the draft is marked approved", (await status(firstId)) === "approved", await status(firstId));
  await page.getByText(new RegExp(`Sent to ${first}`)).waitFor({ timeout: 4000 }).catch(() => {});
  check("the studio is told it went", await page.getByText(new RegExp(`Sent to ${first}`)).isVisible().catch(() => false));

  // 2. Undo: nothing sent, the card comes back.
  await sleep(4500); // let the toasts clear
  let second = await topName();
  if (second === "Priya Sen") {
    // Only the careful one left of the quick pair's turn — nothing to undo-test on.
    check("undo test needs a quick draft on top", false, "Priya was on top");
  } else {
    const secondId = idFor[second];
    await drag(180);
    await page.getByRole("button", { name: "Undo" }).click({ timeout: 4000 });
    await page.getByText("Kept as a draft — nothing was sent").waitFor({ timeout: 4000 });
    check("Undo keeps it as a draft", true);
    await sleep(6500);
    check("and nothing more went to Meta", sent.length === 1, JSON.stringify(sent));
    check("the draft is still pending", (await status(secondId)) === "pending", await status(secondId));
    check("and back on the deck", (await topName()) === second, await topName());

    // 3. Swipe left: the conversation, not a send.
    await drag(-180);
    await page.waitForURL(new RegExp(`/messages\\?thread=${secondId}`), { timeout: 5000 }).catch(() => {});
    check("a left swipe opens that conversation to edit", page.url().includes(`thread=${secondId}`), page.url());
    check("and still sends nothing", sent.length === 1 && (await status(secondId)) === "pending");
    await page.goto(BASE, { waitUntil: "load" });
    await page.getByText(/ready to send/i).waitFor();
  }

  // 5. The rest of the page.
  check("the post queue is counted", /2 queued/i.test(await main()), (await main()).slice(0, 400));
  const n = events.length;
  check(`today's bookings are counted (${n})`, new RegExp(`${n} today`, "i").test(await main()));
  check("the timeline says who is in the chair now", /Now · Noah/.test(await main()), (await main()).match(/In the chair today[^\n]*\n?[^\n]*/)?.[0]);
  check("people waiting without a draft are not forgotten", /1 more person is waiting without a draft/.test(await main()));

  const nav = page.locator('nav[aria-label="Main"]');
  check("the bottom menu is there on a phone", await nav.isVisible());
  check("with the drafts count on Messages", /Messages\s*2|2\s*Messages|Messages2/.test((await nav.innerText()).replace(/\n/g, " ")), await nav.innerText());
  await nav.getByRole("link", { name: /Bookings/ }).click();
  await page.waitForURL(/\/bookings/);
  check("Bookings is one tap away", page.url().endsWith("/bookings"));
  await nav.getByRole("button", { name: /More/ }).click();
  check("More opens the full menu", await page.locator("aside:visible").first().isVisible());
  await nav.getByRole("button", { name: /More/ }).click();

  // 4. The careful one, alone on the deck.
  await sql.query("UPDATE pending_replies SET status = 'rejected' WHERE conversation_id <> 'priya' AND status = 'pending'");
  const before = sent.length;
  await page.goto(BASE, { waitUntil: "load" });
  await page.getByText(/1 ready to send/i).waitFor({ timeout: 15000 });
  check("a personal message is flagged on the card", await page.getByText(/Something personal/).isVisible());
  check("its button says Open chat, not Send", await page.getByRole("button", { name: "Open chat" }).isVisible());
  await page.screenshot({ path: `${SHOTS}/03-phone-needs-a-person.png` });
  await drag(180);
  await page.waitForURL(/thread=priya/, { timeout: 5000 }).catch(() => {});
  await sleep(6000);
  check("swiping it right opens the chat", page.url().includes("thread=priya"), page.url());
  check("and sends nothing", sent.length === before && (await status("priya")) === "pending", `${sent.length} ${await status("priya")}`);

  // Nothing left.
  await sql.query("UPDATE pending_replies SET status = 'rejected' WHERE status = 'pending'");
  await page.goto(BASE, { waitUntil: "load" });
  await page.getByText(/All caught up/).waitFor({ timeout: 15000 });
  check("an empty deck says all caught up", true);
  await page.screenshot({ path: `${SHOTS}/04-phone-caught-up.png` });

  // A laptop: two columns, no bottom menu.
  await sql.query("UPDATE pending_replies SET status = 'pending' WHERE conversation_id IN ('josh', 'priya')");
  const laptop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await laptop.addCookies([{ name: "runnit_session", value: cookie, url: BASE }]);
  const desk = await laptop.newPage();
  desk.on("pageerror", (e) => errors.push(e.message));
  await desk.goto(BASE, { waitUntil: "load" });
  await desk.getByText(/ready to send/i).waitFor({ timeout: 15000 });
  await sleep(2500);
  check("no bottom menu on a laptop", !(await desk.locator('nav[aria-label="Main"]').isVisible()));
  await desk.screenshot({ path: `${SHOTS}/05-laptop-home.png` });

  // Another studio's look: the same screen in Coffee & Silver.
  await sql.query("UPDATE studios SET theme = 'coffee', mode = NULL");
  await page.goto(BASE, { waitUntil: "load" });
  await page.getByText(/ready to send/i).waitFor({ timeout: 15000 });
  await sleep(2500);
  await page.screenshot({ path: `${SHOTS}/06-phone-coffee-theme.png` });

  check("no errors in the page", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  run.server.kill();
  await sql.end();
  graph.close();
  model.close();
  ics.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nAll home checks passed");
process.exit(failures ? 1 : 0);
