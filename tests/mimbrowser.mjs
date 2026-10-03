// "We'll check with Mim", on a phone, in a real browser against the built
// server: the Settings card that connects the email, the line on a draft that
// says sending it will email her, and the Send to Mim button in a thread.
// Plus the picture routes: studio only, and real PNGs.
//
// Runs the built server on its own database, on UTC. Screenshots go to
// SHOTS (default: a temp folder) for a person to look at.
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TZ = "UTC";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ADMIN = process.env.DATABASE_URL || "mysql://ci:ci@127.0.0.1:3306/cityink";
const DB = ADMIN.replace(/\/[^/]*$/, "/runnit_mim");
const PORT = 4900 + Math.floor(Math.random() * 90);
const RELAY_PORT = PORT + 1000;
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = "mim-test-code-123";
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "mim-"));

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};

const mysql = (await import(`${ROOT}/node_modules/mysql2/promise.js`)).default;
const admin = await mysql.createConnection(ADMIN);
await admin.query("DROP DATABASE IF EXISTS runnit_mim");
await admin.query("CREATE DATABASE runnit_mim");
await admin.end();

// Google's Apps Script, as far as this app can tell: a 302 to the answer.
const relayed = [];
const relay = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.method === "POST") {
      const body = JSON.parse(raw || "{}");
      relayed.push(body);
      res.statusCode = 302;
      res.setHeader("location", `/done?to=${encodeURIComponent(body.to === "me" ? "brad@example.test" : body.to)}`);
      return res.end();
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, to: new URL(req.url, "http://x").searchParams.get("to") }));
  });
});
await new Promise((r) => relay.listen(RELAY_PORT, r));

async function boot() {
  const server = spawn("node", ["dist/server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TZ: "UTC",
      PORT: String(PORT),
      DATABASE_URL: DB,
      FACEBOOK_GRAPH_URL: "http://127.0.0.1:1",
      LLM_API_KEY: "",
      NODE_ENV: "production",
      PUBLIC_SIGNUP: "",
      DASHBOARD_PASSWORD: "",
      STUDIO_CLAIM_CODE: CODE,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 80 && !/Schema ready/.test(log); i++) await new Promise((r) => setTimeout(r, 250));
  return { server, log: () => log };
}

let run = await boot();
run.server.kill();
await new Promise((r) => setTimeout(r, 500));
const sql = await mysql.createConnection(DB);
await sql.query(
  `INSERT INTO facebook_config (page_id, page_name, page_access_token, app_id, app_secret, webhook_verify_token, is_configured)
   VALUES ('P1', 'City Ink Tattoo Geelong', 'tok', 'app', 'secret', 'verify', 1)`
);
const ago = (m) => new Date(Date.now() - m * 60_000);
await sql.query(
  "INSERT INTO messenger_conversations (conversation_id, sender_name, platform, last_message_at, last_customer_message_at, created_at) VALUES ('jess','Jess Taylor','instagram',?,?,?)",
  [ago(2), ago(2), ago(40)]
);
await sql.query(
  "INSERT INTO messenger_messages (conversation_id, message_id, sender_type, content, created_at) VALUES ('jess','j1','customer','Hey! How much for a fine line piece on my forearm? 😊',?),('jess','j2','manual','About $250 - $350 for that size 👌',?),('jess','j3','customer','My budget is around $200, could Mim do Saturday? 🙏',?)",
  [ago(40), ago(30), ago(2)]
);
await sql.query(
  "INSERT INTO pending_replies (conversation_id, customer_message_id, draft_text, alternatives, status, created_at) VALUES ('jess','j3',?,?,'pending',?)",
  ["No worries at all 😊 I'll check with Mim and get back to you!", JSON.stringify([{ label: "Short and casual", text: "Il see what we can do 👌" }]), ago(1)]
);

run = await boot();
const { chromium } = await import(`${ROOT}/node_modules/playwright/index.mjs`);
const executablePath = fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
  ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
  : undefined;
const browser = await chromium.launch({ executablePath });

try {
  // The owner, with the studio's code, set up.
  const signup = await fetch(`${BASE}/api/trpc/account.signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Brad Test", email: "brad@example.test", password: "password123", code: CODE }),
  });
  const cookieLine = (signup.headers.getSetCookie?.() ?? []).find((l) => l.startsWith("runnit_session="));
  const token = cookieLine?.split(";")[0].split("=")[1];
  check("the owner signs up with the code", signup.status === 200 && !!token, String(signup.status));
  await sql.query("UPDATE users SET onboarding_completed_at = NOW(), onboarding_step = 'done'");
  const auth = { cookie: `runnit_session=${token}` };

  // Pictures: studio only, and real PNGs.
  const anonSample = await fetch(`${BASE}/api/snapshot/sample.png`);
  check("a stranger can't fetch the sample picture", anonSample.status === 401, String(anonSample.status));
  const anonThread = await fetch(`${BASE}/api/snapshot/jess.png`);
  check("a stranger can't fetch a customer's conversation", anonThread.status === 401, String(anonThread.status));
  const thread = await fetch(`${BASE}/api/snapshot/jess.png`, { headers: auth });
  const threadPng = Buffer.from(await thread.arrayBuffer());
  check("the studio can, and it's a PNG", thread.status === 200 && threadPng.subarray(1, 4).toString() === "PNG", String(thread.status));
  fs.writeFileSync(`${SHOTS}/conversation.png`, threadPng);

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: "runnit_session", value: token, url: BASE }]);
  const page = await ctx.newPage();

  // Settings → Inbox, nothing set up yet.
  await page.goto(`${BASE}/settings?tab=inbox#check-with`, { waitUntil: "domcontentloaded" });
  const card = page.locator("#check-with");
  await card.waitFor({ timeout: 15000 });
  await card.scrollIntoViewIfNeeded();
  check("the card says email isn't connected yet", /isn't connected yet/.test(await card.innerText()));
  check("the setup steps are open, with the script", (await card.locator("pre").innerText()).includes("function doPost"));
  await card.screenshot({ path: `${SHOTS}/settings-empty.png` });

  await card.getByPlaceholder("Mim").fill("Mim");
  await card.getByPlaceholder("name@gmail.com").fill("mim@example.test");
  await card.getByPlaceholder("https://script.google.com/macros/s/…/exec").fill(`http://127.0.0.1:${RELAY_PORT}/macros/s/x/exec`);
  check("an address that isn't Apps Script is pointed out", /doesn't look like an Apps Script/.test(await card.innerText()));
  await card.getByRole("button", { name: "Save" }).click();
  await page.getByText("On. Mim is emailed whenever").waitFor({ timeout: 10000 });
  check("saved: the card says it's on", true);

  await card.getByRole("button", { name: "Send me a test" }).click();
  await page.getByText(/Test sent to/).waitFor({ timeout: 15000 });
  check("the test goes to me, not to her", relayed.at(-1)?.to === "me");

  await card.getByRole("button", { name: "See what Mim gets" }).click();
  const preview = card.locator("img[src='/api/snapshot/sample.png']");
  await preview.waitFor({ timeout: 10000 });
  await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await preview.elementHandle(), { timeout: 10000 });
  check("the preview picture loads", (await preview.evaluate((el) => el.naturalWidth)) === 780);
  await card.screenshot({ path: `${SHOTS}/settings-on.png` });

  // The thread: the draft says sending it emails Mim; Send to Mim works.
  await page.goto(`${BASE}/messages?thread=jess`, { waitUntil: "domcontentloaded" });
  const note = page.getByText("Sending this emails Mim a picture of the conversation to check.");
  await note.waitFor({ timeout: 15000 });
  check("the draft says approving it will email Mim", await note.isVisible());
  const box = page.getByLabel("Draft reply to Jess Taylor");
  await box.fill("No worries 😊 see you Saturday!");
  check("rewriting it without Mim takes the line away", (await note.count()) === 0 || !(await note.isVisible()));
  await box.fill("No worries at all 😊 I'll check with Mim and get back to you!");

  const send = page.getByRole("button", { name: "Send this conversation to Mim" });
  await send.scrollIntoViewIfNeeded();
  const tappable = await send.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
  check("Send to Mim is tappable on a phone", tappable);
  await page.screenshot({ path: `${SHOTS}/thread.png` });
  const before = relayed.length;
  await send.click();
  await page.getByText("Emailed Mim about Jess Taylor").waitFor({ timeout: 15000 });
  check("Send to Mim emails her", relayed.length === before + 1 && relayed.at(-1)?.to === "mim@example.test");
  check("with the conversation drawn in", Buffer.from(relayed.at(-1)?.image ?? "", "base64").subarray(1, 4).toString() === "PNG");

  await ctx.close();
} catch (error) {
  check("the browser walk finished", false, (error && error.stack) || String(error));
  console.log(run.log().slice(-2000));
} finally {
  await browser.close();
  run.server.kill();
  relay.close();
  await sql.end();
}

console.log(`Screenshots in ${SHOTS}`);
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
