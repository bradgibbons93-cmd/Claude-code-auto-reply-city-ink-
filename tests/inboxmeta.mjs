// Brad, 29 September, with the board open on Nett and Paige — a thread with
// a months-old deposit receipt in it, above a draft asking her what size she
// wanted: "Always remove messages that have been replied to already." Then a
// screen recording of Meta's inbox: "I WANT IT BASICALLY TO LOOK LIKE THE
// SAME ORDER AND EVERYTHING AS METAS INBOX". And, the day before, under a
// draft that asked a customer for centimetres: "She clearly sent photos with
// basically the exact size ... base it roughly from what they send and give a
// rough estimate price".
//
// Three things are proved here, against a real database and the real
// drafting path:
//   1. the board drops drafts nobody can send any more, and reads newest-first
//   2. the inbox list carries Meta's preview line ("sent 2 photos")
//   3. the model is actually SHOWN the photos — asserted on the request body
//      that went to the provider, not on a setting — and a provider that
//      refuses a photo still produces a draft.
//
// Runs on UTC, as Railway does — Node here, and the database too
// (--default-time-zone=+00:00). On a machine set to Brisbane time the
// timestamps these seed and the ones MySQL stamps disagree by ten hours.
import http from "node:http";

process.env.TZ = "UTC";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
process.env.DATABASE_URL ||= "mysql://ci:ci@127.0.0.1:3306/cityink";
process.env.FACEBOOK_GRAPH_URL = "http://127.0.0.1:4433";
process.env.LLM_PROVIDER = "anthropic";
process.env.LLM_BASE_URL = "http://127.0.0.1:4434";
process.env.LLM_API_KEY = "sk-ant-test";
process.env.LLM_MODEL = "claude-sonnet-5";

const TINY_JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAYABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDn6KKK8k/QAooooAKKKKACiiigD//Z", "base64");

// A Graph that knows nobody — drafting must not depend on it.
const graph = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ data: [] }));
});
await new Promise((r) => graph.listen(4433, r));

// A stand-in model that remembers what it was sent.
let bodies = [];
let refuseImages = false;
const model = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    bodies.push(body);
    res.setHeader("content-type", "application/json");
    const sawImage = JSON.stringify(body.messages ?? []).includes('"type":"image"');
    if (refuseImages && sawImage) {
      res.statusCode = 400;
      return res.end(JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "messages.3.content.0.image.source: Could not process image" },
      }));
    }
    res.end(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify({
        reply: "Hey 😊 thanks for sending these! A small wrist piece and a fine line down the forearm, you'd be looking at about $250 - $350 for both",
        alternatives: [{ label: "Short and casual", text: "About $250 - $350 for both 😊" }],
        intent: "pricing", sensitive: false,
      }) }],
      stop_reason: "end_turn",
    }));
  });
});
await new Promise((r) => model.listen(4434, r));

const db = await import(`${ROOT}/dist/server/db.js`);
const { ensureTables } = await import(`${ROOT}/dist/server/migrate.js`);
await ensureTables();
const agent = await import(`${ROOT}/dist/server/agent.js`);
const mysql = (await import("mysql2/promise")).default;
const sql = await mysql.createConnection(process.env.DATABASE_URL);

let failures = 0;
const check = (n, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};

// A clean slate for the tables this touches.
for (const t of ["pending_replies", "messenger_messages", "messenger_conversations", "message_attachments", "studio_knowledge"]) {
  await sql.query(`DELETE FROM ${t}`).catch(() => {});
}

const ago = (h) => new Date(Date.now() - h * 3600 * 1000);
async function thread(id, name, platform, msgs) {
  const last = msgs[msgs.length - 1];
  await sql.query(
    "INSERT INTO messenger_conversations (conversation_id, sender_name, platform, last_message_at, created_at) VALUES (?,?,?,?,?)",
    [id, name, platform, ago(last.h), ago(msgs[0].h)]
  );
  for (const m of msgs) {
    await sql.query(
      "INSERT INTO messenger_messages (conversation_id, message_id, sender_type, content, attachment_urls, created_at) VALUES (?,?,?,?,?,?)",
      [id, m.id, m.who, m.text, m.photos ? JSON.stringify(m.photos) : null, ago(m.h)]
    );
  }
}
async function draft(conversationId, messageId, text, h) {
  await sql.query(
    "INSERT INTO pending_replies (conversation_id, customer_message_id, draft_text, status, created_at) VALUES (?,?,?,'pending',?)",
    [conversationId, messageId, text, ago(h)]
  );
}

/* ---------- 1. the board ---------- */
// Paige: wrote months ago, never answered where the app could see.
await thread("paige", "Paige Test", "instagram", [
  { id: "p1", who: "customer", text: "(sent a photo)", h: 24 * 40, photos: ["/api/attachments/old"] },
]);
await draft("paige", "p1", "What size are you thinking?", 2);
// Claire: wrote 11 minutes ago.
await thread("claire", "Claire Test", "facebook", [
  { id: "c1", who: "customer", text: "Hi, how much for a small rose?", h: 0.2 },
]);
await draft("claire", "c1", "Hey Claire!", 0.1);
// Alex: wrote 7 hours ago.
await thread("alex", "Alex Test", "instagram", [
  { id: "a1", who: "customer", text: "Hello!", h: 7 },
]);
await draft("alex", "a1", "Hey Alex!", 6.9);
// Grace: studio answered by hand after the draft was written.
await thread("grace", "Grace Test", "instagram", [
  { id: "g1", who: "customer", text: "Can I move my booking?", h: 22 },
  { id: "g2", who: "manual", text: "Yep all sorted", h: 21 },
]);
await draft("grace", "g1", "Sure, what day suits?", 21.5);
// Faith: a cold follow-up, written for a quiet thread on purpose.
await thread("faith", "Faith Test", "instagram", [
  { id: "f1", who: "customer", text: "How much for a sleeve?", h: 24 * 10 },
  { id: "f2", who: "manual", text: "About $1500 over 3 sessions", h: 24 * 9 },
]);
await draft("faith", "followup_cold_faith_1", "Hey, just checking in on this one 😊", 1);

const board = await db.getPendingReplies();
const ids = board.map((d) => d.conversationId);
check("a draft for someone who last wrote over a week ago is gone", !ids.includes("paige"), ids.join(","));
check("a draft answered by hand since is gone", !ids.includes("grace"), ids.join(","));
check("a follow-up is kept, even on an old thread", ids.includes("faith"), ids.join(","));
check("the board reads newest first, like Meta's inbox",
  ids.indexOf("claire") === 0 && ids.indexOf("alex") === 1, ids.join(","));
check("and a follow-up sits below the people who just wrote", ids.indexOf("faith") > ids.indexOf("alex"), ids.join(","));

/* ---------- 2. the inbox list ---------- */
await thread("liv", "LIV Test", "instagram", [
  { id: "l1", who: "customer", text: "(sent a photo)", h: 13, photos: ["/api/attachments/x1", "/api/attachments/x2"] },
]);
const list = await db.getRecentConversations();
const liv = list.find((c) => c.conversationId === "liv");
const grace = list.find((c) => c.conversationId === "grace");
check("the list carries how many photos the last message had", liv?.lastPhotoCount === 2, JSON.stringify(liv));
check("and the last thing said", grace?.lastPreview === "Yep all sorted", JSON.stringify(grace));
check("and who said it", grace?.lastSenderType === "manual" && liv?.lastSenderType === "customer");
check("newest first", list[0]?.conversationId === "claire", list.map((c) => c.conversationId).join(","));

/* ---------- 3. the model sees the photos ---------- */
await sql.query(
  "INSERT INTO message_attachments (id, conversation_id, message_id, content_type, bytes) VALUES (?,?,?,?,?)",
  ["tinywrist", "nina", "n1", "image/jpeg", TINY_JPEG]
);
await sql.query(
  "INSERT INTO message_attachments (id, conversation_id, message_id, content_type, bytes) VALUES (?,?,?,?,?)",
  ["tinyarm", "nina", "n1", "image/jpeg", TINY_JPEG]
);
await thread("nina", "Nina Test", "facebook", [
  { id: "n1", who: "customer", text: "(sent a photo)", h: 0.1, photos: ["/api/attachments/tinywrist", "/api/attachments/tinyarm"] },
  { id: "n2", who: "customer", text: "Hi, how much for these two done together?", h: 0.05 },
]);
await db.setSetting("google_review_url", "").catch(() => {});

bodies = [];
await agent.draftForUnanswered(5, 60);
const sent = bodies.find((b) => JSON.stringify(b.messages).includes("how much for these two"));
const lastUser = sent?.messages?.filter((m) => m.role === "user").pop();
const images = Array.isArray(lastUser?.content) ? lastUser.content.filter((p) => p.type === "image") : [];
check("the model is sent the customer's photos", images.length === 2, JSON.stringify(lastUser)?.slice(0, 200));
check("as real image bytes", images[0]?.source?.type === "base64" && images[0]?.source?.media_type === "image/jpeg"
  && Buffer.from(images[0]?.source?.data ?? "", "base64").equals(TINY_JPEG));
check("on the message being answered, with its words", Array.isArray(lastUser?.content)
  && lastUser.content.some((p) => p.type === "text" && /how much for these two/.test(p.text)));
check("and told to price from them, not to ask for centimetres",
  /READING THEIR PHOTOS/.test(sent?.system ?? "") && /Do NOT ask them for exact centimetres/.test(sent?.system ?? ""));
const nina = (await db.getPendingReplies()).find((d) => d.conversationId === "nina");
check("the draft lands on the board", !!nina && /\$250/.test(nina.draftText), JSON.stringify(nina)?.slice(0, 160));

/* ---------- 4. a provider that refuses a photo still gets a draft written ---------- */
await sql.query("DELETE FROM pending_replies WHERE conversation_id = 'nina'");
refuseImages = true;
bodies = [];
await agent.draftForUnanswered(5, 60);
const retried = bodies.filter((b) => JSON.stringify(b.messages).includes("how much for these two"));
check("it asks once with the photos, then again without", retried.length === 2
  && JSON.stringify(retried[0].messages).includes('"type":"image"')
  && !JSON.stringify(retried[1].messages).includes('"type":"image"'), String(retried.length));
const ninaAgain = (await db.getPendingReplies()).find((d) => d.conversationId === "nina");
check("and the customer still gets a draft", !!ninaAgain && !ninaAgain.llmFailed, JSON.stringify(ninaAgain)?.slice(0, 160));

await sql.end();
graph.close();
model.close();
console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
