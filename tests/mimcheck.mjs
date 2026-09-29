// Brad, 29 September: "If anything is written that we will check with Mim
// (please fix spelling in the app) then take a screenshot and send Mim an
// email checking at mercymim90@gmail.com".
//
// Proved here, against a real database, the real drafting path and the real
// send path, with stand-ins for Meta, the model and Google's Apps Script:
//   1. the prompt names Mim, and a draft that spells her "mim" is corrected
//   2. approving a reply that says we'll check with her emails her ONCE, with
//      a real PNG of the conversation, through a relay that redirects the way
//      Google's does
//   3. Instagram's echo of that same reply doesn't email her a second time;
//      a different reply typed by hand does; "Mim can do 3pm" doesn't
//   4. with email not set up nothing throws and the miss is recorded; the
//      relay's own refusals come back as sentences a person can act on
//   5. the test button goes to "me", never to her
import http from "node:http";

process.env.TZ = "UTC";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
process.env.DATABASE_URL ||= "mysql://ci:ci@127.0.0.1:3306/cityink";
process.env.FACEBOOK_GRAPH_URL = "http://127.0.0.1:4453";
process.env.LLM_PROVIDER = "anthropic";
process.env.LLM_BASE_URL = "http://127.0.0.1:4454";
process.env.LLM_API_KEY = "sk-ant-test";
process.env.LLM_MODEL = "claude-sonnet-5";
delete process.env.CHECK_WITH_NAME;
delete process.env.CHECK_WITH_EMAIL;
delete process.env.MAIL_RELAY_URL;

let failures = 0;
const check = (n, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Meta: every send succeeds.
const sends = [];
const graph = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url.startsWith("/me/messages")) {
      sends.push(JSON.parse(raw || "{}"));
      return res.end(JSON.stringify({ recipient_id: "x", message_id: `mid_${sends.length}` }));
    }
    res.end(JSON.stringify({ data: [] }));
  });
});
await new Promise((r) => graph.listen(4453, r));

// The model: writes "mim" in lower case, the way customers do.
const prompts = [];
const model = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    prompts.push(typeof body.system === "string" ? body.system : JSON.stringify(body.system ?? body.messages ?? ""));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify({
        reply: "No worries at all 😊 I'll check with mim and get back to you!",
        alternatives: [{ label: "Short and casual", text: "Il ask MIM and let you know 👌" }],
        intent: "pricing", sensitive: false,
      }) }],
      stop_reason: "end_turn",
    }));
  });
});
await new Promise((r) => model.listen(4454, r));

// Google's Apps Script: a POST is answered with a 302 to where the result
// is, and the result is JSON. `mode` switches in the refusals.
const relayed = [];
let mode = "ok";
let expectedSecret = "";
const relay = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.method === "POST" && req.url.startsWith("/macros/s/test/exec")) {
      const body = JSON.parse(raw || "{}");
      relayed.push(body);
      const result =
        mode === "signin" ? "signin"
        : body.secret !== expectedSecret ? JSON.stringify({ ok: false, error: "wrong secret" })
        : JSON.stringify({ ok: true, to: body.to === "me" ? "brad@example.test" : body.to });
      res.statusCode = 302;
      res.setHeader("location", `/echo?r=${encodeURIComponent(result)}`);
      return res.end();
    }
    if (req.url.startsWith("/echo")) {
      const r = decodeURIComponent(new URL(req.url, "http://x").searchParams.get("r"));
      if (r === "signin") {
        res.setHeader("content-type", "text/html");
        return res.end("<html><title>Sign in - Google Accounts</title><a href='https://accounts.google.com/ServiceLogin'>Sign in</a></html>");
      }
      res.setHeader("content-type", "application/json");
      return res.end(r);
    }
    res.statusCode = 404;
    res.end();
  });
});
await new Promise((r) => relay.listen(4455, r));
const RELAY = "http://127.0.0.1:4455/macros/s/test/exec";

const { ensureTables } = await import(`${ROOT}/dist/server/migrate.js`);
await ensureTables();
const agent = await import(`${ROOT}/dist/server/agent.js`);
const cw = await import(`${ROOT}/dist/server/checkWith.js`);
const { saveImageBytes } = await import(`${ROOT}/dist/server/attachments.js`);
const sharp = (await import("sharp")).default;
const mysql = (await import("mysql2/promise")).default;
const sql = await mysql.createConnection(process.env.DATABASE_URL);

for (const t of ["pending_replies", "messenger_messages", "messenger_conversations", "message_attachments", "check_alerts", "facebook_config"]) {
  await sql.query(`DELETE FROM ${t}`).catch(() => {});
}
await sql.query("DELETE FROM app_settings WHERE name IN ('check_with_name','check_with_email','mail_relay_url') OR name LIKE 'alerted_%'");
await sql.query(
  "INSERT INTO facebook_config (page_id, page_name, page_access_token, app_id, app_secret, webhook_verify_token, is_configured) VALUES ('page1','City Ink Tattoo Geelong','tok','app','secret','verify',1)"
);

/* ---------- the tests that need no database ---------- */
const says = [
  ["I'll check with Mim and get back to you", true],
  ["Il check with mim and come back to you 😊", true],
  ["Let me double check that with Mim first", true],
  ["I'll run it past Mim and let you know", true],
  ["Il ask Mim about Saturday", true],
  ["Mim will get back to you shortly", true],
  ["Mim'll confirm the price tomorrow", true],
  ["I'll see what Mim says", true],
  ["Mim can do this at 3pm 🙂 would you like to confirm the booking?", false],
  ["Would you like to confirm the booking with Mim at 3pm?", false],
  ["Thanks so much, see you Saturday!", false],
  ["I'll check with the team and get back to you", false],
  ["I'll check with Mimi and get back to you", false],
];
for (const [text, expected] of says) {
  check(`"${text}" ${expected ? "is" : "is not"} a promise to check with Mim`, cw.mentionsCheckWith(text, "Mim") === expected);
}
check("fixNameSpelling: mim → Mim", cw.fixNameSpelling("I'll check with mim", "Mim") === "I'll check with Mim");
check("fixNameSpelling: MIM's → Mim's", cw.fixNameSpelling("MIM's free Saturday", "Mim") === "Mim's free Saturday");
check("fixNameSpelling leaves Mimi and 'mimic' alone", cw.fixNameSpelling("Mimi can mimic it", "Mim") === "Mimi can mimic it");

/* ---------- 1. the draft ---------- */
await cw.saveCheckWith({ name: "Mim", email: "mim@example.test", relayUrl: RELAY });
expectedSecret = (await cw.getCheckWith()).secret;
check("a relay key is made once and kept", expectedSecret.length >= 20 && (await cw.getCheckWith()).secret === expectedSecret);

const photo = await sharp({ create: { width: 800, height: 1000, channels: 3, background: "#b98f6a" } }).jpeg().toBuffer();
const kept = await saveImageBytes("image/jpeg", photo, "jess");
const ago = (m) => new Date(Date.now() - m * 60_000);
await sql.query(
  "INSERT INTO messenger_conversations (conversation_id, sender_name, platform, last_message_at, created_at) VALUES ('jess','Jess Taylor','instagram',?,?)",
  [ago(1), ago(30)]
);
await sql.query(
  "INSERT INTO messenger_messages (conversation_id, message_id, sender_type, content, attachment_urls, created_at) VALUES ('jess','j1','customer','(sent a photo)',?,?),('jess','j2','customer','My budget is about $200, could Mim do Saturday? 🙏',NULL,?)",
  [JSON.stringify([kept.url]), ago(3), ago(1)]
);

const drafted = await agent.draftForUnanswered(5);
check("a draft is written for Jess", drafted.drafted === 1, JSON.stringify(drafted));
check("the prompt tells the model to check with Mim by name", prompts.some((p) => p.includes("check with Mim") && p.includes("CHECKING WITH MIM")));
check("the prompt no longer defers to 'the team' for budgets", !prompts.some((p) => p.includes("say you'll check with the team and come back")));
const [[row]] = await sql.query("SELECT id, draft_text AS draftText, alternatives FROM pending_replies WHERE conversation_id='jess' AND status='pending'");
check("the draft spells her Mim", row?.draftText === "No worries at all 😊 I'll check with Mim and get back to you!", row?.draftText);
const alts = typeof row?.alternatives === "string" ? JSON.parse(row.alternatives) : row?.alternatives;
check("so do the other versions", alts?.[0]?.text === "Il ask Mim and let you know 👌", JSON.stringify(alts));
check("drafting emails nobody", relayed.length === 0);

/* ---------- 2. approving it ---------- */
await agent.approveDraft(row.id);
await wait(2500);
check("the reply went to the customer", sends.length === 1);
check("Mim is emailed once", relayed.length === 1, `relayed ${relayed.length}`);
const mail = relayed[0] ?? {};
check("to her address", mail.to === "mim@example.test", mail.to);
check("with the app's key", mail.secret === expectedSecret);
check("subject names the customer", /Jess Taylor/.test(mail.subject ?? "") && /check/i.test(mail.subject ?? ""), mail.subject);
check("the email opens with her name", /Hi Mim/.test(mail.html ?? ""));
check("and quotes what they asked", /could Mim do Saturday/.test(mail.html ?? ""));
check("the picture is in the email body", /cid:conversation/.test(mail.html ?? ""));
const png = mail.image ? Buffer.from(mail.image, "base64") : Buffer.alloc(0);
check("the picture is a PNG", png.subarray(1, 4).toString() === "PNG");
const meta = png.length ? await sharp(png).metadata() : {};
check("drawn phone-width at 2x (780px)", meta.width === 780, String(meta.width));
check("tall enough to hold the thread and the photo", (meta.height ?? 0) > 700, String(meta.height));
const [[alert]] = await sql.query("SELECT status, detail FROM check_alerts ORDER BY id DESC LIMIT 1");
check("recorded as sent", alert?.status === "sent", JSON.stringify(alert));

/* ---------- 3. echoes ---------- */
await agent.handleEcho("jess", "ig_echo_1", "No worries at all 😊 I'll check with Mim and get back to you!");
await wait(1500);
check("Instagram's echo of the same reply doesn't email her twice", relayed.length === 1, `relayed ${relayed.length}`);

await agent.handleEcho("jess", "ig_typed_1", "Il ask Mim about Saturday and let you know 👌");
await wait(2500);
check("a different reply typed by hand in Instagram emails her", relayed.length === 2, `relayed ${relayed.length}`);

await agent.handleEcho("jess", "ig_typed_2", "Mim can do this at 3pm 🙂 would you like to confirm the booking?");
await wait(1500);
check("'Mim can do 3pm' is an answer, not a deferral — no email", relayed.length === 2, `relayed ${relayed.length}`);

/* ---------- 4. when it can't send ---------- */
await cw.saveCheckWith({ name: "Mim", email: "mim@example.test", relayUrl: "" });
let threw = false;
try {
  await cw.askToCheck("jess", "I'll check with Mim on the price", "typed");
} catch {
  threw = true;
}
check("email not set up: nothing throws", !threw);
check("email not set up: nothing is posted", relayed.length === 2);
const [[missed]] = await sql.query("SELECT status, detail FROM check_alerts ORDER BY id DESC LIMIT 1");
check("email not set up: the miss is recorded, in words", missed?.status === "failed" && /isn't set up/.test(missed?.detail ?? ""), JSON.stringify(missed));

await cw.saveCheckWith({ name: "Mim", email: "mim@example.test", relayUrl: RELAY });
expectedSecret = "a-different-key";
await cw.askToCheck("jess", "I'll check with Mim about the colour", "typed");
const [[wrongKey]] = await sql.query("SELECT status, detail FROM check_alerts ORDER BY id DESC LIMIT 1");
check("a script with the wrong key says to copy it again", wrongKey?.status === "failed" && /Copy the script/.test(wrongKey?.detail ?? ""), wrongKey?.detail);

mode = "signin";
await cw.askToCheck("jess", "I'll check with Mim about the size", "typed");
const [[signin]] = await sql.query("SELECT status, detail FROM check_alerts ORDER BY id DESC LIMIT 1");
check("a deployment Google won't run says 'Who has access: Anyone'", /Who has access/.test(signin?.detail ?? ""), signin?.detail);
mode = "ok";
expectedSecret = (await cw.getCheckWith()).secret;

/* ---------- 5. the test button and the list ---------- */
const before = relayed.length;
const test = await cw.sendTest();
check("the test sends", test.ok, test.detail);
check("the test goes to me, never to her", relayed[before]?.to === "me");
check("the test says it's a test", /^Test/.test(relayed[before]?.subject ?? ""));

const sentNow = await cw.sendNow("jess");
check("Send to Mim from the thread emails her", sentNow.ok && relayed.at(-1)?.to === "mim@example.test", sentNow.detail);

const recent = await cw.recentChecks(5);
check("Settings can list what went out, named", recent.length >= 3 && recent.some((r) => r.customer === "Jess Taylor" && r.status === "sent"));

await cw.saveCheckWith({ name: "", email: "mim@example.test", relayUrl: RELAY });
const n = relayed.length;
await cw.askToCheck("jess", "I'll check with Mim and get back to you tomorrow", "typed");
check("an empty name turns it off", relayed.length === n);

await sql.end();
graph.close();
model.close();
relay.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
