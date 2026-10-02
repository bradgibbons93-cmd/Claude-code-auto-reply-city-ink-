// A date the customer names is looked up, however far out, up to six months.
//
// Brad, 2 October, with Shae's card on screen:
//
//   "Any availability for Saturday 12th December please?"
//
// and the draft: "December is a bit further out than what we've got loaded in
// the books right now, so I'll check with Mim". The books were fine. The
// agent's two-month window ended in early December, so the 12th had never
// been looked at. His words: "it needs to look a couple months into the
// calendar if requested by the customer".
//
// This suite reads the customer's own words for dates the way the app does,
// then drives a real draft (draftForUnanswered, the poll's own path) against
// a stand-in calendar and model, and reads what the model was actually told.
import http from "node:http";

process.env.TZ = "UTC";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
process.env.DATABASE_URL ||= "mysql://ci:ci@127.0.0.1:3306/cityink";
const MODEL_PORT = 4950 + Math.floor(Math.random() * 40);
const ICS_PORT = MODEL_PORT + 100;
process.env.FACEBOOK_GRAPH_URL = "http://127.0.0.1:1";
process.env.LLM_PROVIDER = "anthropic";
process.env.LLM_BASE_URL = `http://127.0.0.1:${MODEL_PORT}`;
process.env.LLM_API_KEY = "sk-ant-test";
process.env.LLM_MODEL = "claude-sonnet-5";

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};

const calendar = await import(`${ROOT}/dist/server/calendar.js`);
const { datesNamedIn, studioTime, studioDateParts } = calendar;

/* ---------- 1. reading dates out of what they wrote ---------- */
// Friday 2 October 2026, 11am in Geelong.
const FRI = new Date("2026-10-02T01:00:00Z");
const read = (text) => {
  const { days, months } = datesNamedIn([text], FRI);
  return {
    days: days.map((d) => `${d.year}-${String(d.month + 1).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`),
    months: months.map((m) => `${m.year}-${String(m.month + 1).padStart(2, "0")}`),
  };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cases = [
  ["Any availability for Saturday 12th December please?", ["2026-12-12"], []],
  ["could I do 12/12?", ["2026-12-12"], []],
  ["Is 19/12 free, or 20/12?", ["2026-12-19", "2026-12-20"], []],
  ["12/12/26 if possible", ["2026-12-12"], []],
  ["Dec 12?", ["2026-12-12"], []],
  ["December the 12th would be perfect", ["2026-12-12"], []],
  ["the 12th of December", ["2026-12-12"], []],
  ["the 3rd of March", ["2027-03-03"], []],
  ["Saturday the 19th?", ["2026-12-19"], []], // the next 19th that IS a Saturday
  ["is the 19th free", ["2026-10-19"], []],
  ["anything in December?", [], ["2026-12"]],
  ["early Jan maybe", [], ["2027-01"]],
  ["Saturday 12th December, or anything else in December", ["2026-12-12"], []],
];
for (const [text, days, months] of cases) {
  const got = read(text);
  check(`"${text}" → ${[...days, ...months].join(", ")}`, same(got.days, days) && same(got.months, months), JSON.stringify(got));
}
const nothing = [
  "Hi June, love your work",
  "Jan said you're the best",
  "about 2.5 hours I reckon",
  "roughly 10/15cm",
  "I like the 2nd one better",
  "we may come in together",
  "June 10cm wide",
  "I'm 25 and it's my first",
  "there's 3 of us",
  "the 2nd one is better, 8/10 for sure",
];
for (const text of nothing) {
  const got = read(text);
  check(`"${text}" names no date`, !got.days.length && !got.months.length, JSON.stringify(got));
}

/* ---------- 2. a calendar, and the poll drafting against it ---------- */
// Two Saturdays past the everyday two-month list: one booked solid, one with a
// morning booking. Worked out from today so the suite keeps working.
const now = new Date();
const today = studioDateParts(now);
function civil(offsetDays) {
  const d = new Date(Date.UTC(today.year, today.month, today.day + offsetDays));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate() };
}
let k = 70;
while (new Date(Date.UTC(civil(k).year, civil(k).month, civil(k).day)).getUTCDay() !== 6) k++;
const booked = civil(k); // a Saturday, 70-76 days out
const half = civil(k + 7); // the Saturday after
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ord = (n) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
const asked = (d) => `Saturday ${ord(d.day)} ${MONTHS[d.month]}`;
const label = (d) => `Saturday ${d.day} ${MONTHS[d.month]}${d.year !== today.year ? ` ${d.year}` : ""}`;

const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const events = [
  { start: studioTime(booked.year, booked.month, booked.day, 10, 0), end: studioTime(booked.year, booked.month, booked.day, 17, 30), name: "Full day sleeve" },
  { start: studioTime(half.year, half.month, half.day, 10, 30), end: studioTime(half.year, half.month, half.day, 13, 0), name: "Morning piece" },
];
let icsHits = 0;
const ics = http.createServer((req, res) => {
  icsHits++;
  res.setHeader("content-type", "text/calendar");
  res.end(
    [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//dates test//EN",
      ...events.flatMap((e, i) => ["BEGIN:VEVENT", `UID:d${i}@test`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`, `SUMMARY:${e.name}`, "END:VEVENT"]),
      "END:VCALENDAR",
    ].join("\r\n")
  );
});
await new Promise((r) => ics.listen(ICS_PORT, r));

let bodies = [];
const model = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    bodies.push(body);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      content: [{ type: "text", text: JSON.stringify({
        reply: "Hey 😊 let me look at that day for you",
        alternatives: [], intent: "booking", sensitive: false,
        quote: { gives_price: false, size: null, placement: null },
      }) }],
      stop_reason: "end_turn",
    }));
  });
});
await new Promise((r) => model.listen(MODEL_PORT, r));

const { ensureTables } = await import(`${ROOT}/dist/server/migrate.js`);
await ensureTables();
const agent = await import(`${ROOT}/dist/server/agent.js`);
const mysql = (await import(`${ROOT}/node_modules/mysql2/promise.js`)).default;
const sql = await mysql.createConnection(process.env.DATABASE_URL);

try {
  for (const t of ["pending_replies", "messenger_messages", "messenger_conversations", "message_attachments", "timely_config"]) {
    await sql.query(`DELETE FROM ${t}`).catch(() => {});
  }
  await sql.query(
    "INSERT INTO timely_config (booking_page_url, calendar_ics_url, is_configured) VALUES ('https://example.com/book', ?, 1)",
    [`http://127.0.0.1:${ICS_PORT}/cal.ics`]
  );
  const ago = (min) => new Date(Date.now() - min * 60_000);
  async function customer(id, name, text, min) {
    await sql.query(
      "INSERT INTO messenger_conversations (conversation_id, sender_name, platform, last_message_at, created_at) VALUES (?,?, 'instagram', ?, ?)",
      [id, name, ago(min), ago(min)]
    );
    await sql.query(
      "INSERT INTO messenger_messages (conversation_id, message_id, sender_type, content, created_at) VALUES (?,?, 'customer', ?, ?)",
      [id, `${id}1`, text, ago(min)]
    );
  }
  const systemFor = (who) => bodies.map((b) => String(b.system ?? "") + JSON.stringify(b.messages ?? [])).find((s) => s.includes(who)) ?? "";

  // Shae, exactly as on Brad's screen — but for a Saturday that is booked out.
  await customer("shae", "Shae", `Any availability for ${asked(booked)} please?`, 11);
  await agent.draftForUnanswered(5, 60);
  const shae = systemFor(asked(booked));
  check("the model is told about the date she named", shae.includes("THE DATES THIS CUSTOMER ASKED ABOUT, each looked up"), shae.slice(0, 300));
  check(`and that ${label(booked)} is booked out`, shae.includes(`- ${label(booked)}: booked out, nothing free that day.`),
    (shae.match(/THE DATES THIS CUSTOMER ASKED ABOUT[\s\S]{0,400}/) ?? [""])[0]);
  check("and never to call a date too far out", shae.includes('Never tell a customer a date is "too far out"'));

  // Another customer asks about the Saturday after: free from 1pm.
  bodies = [];
  await customer("kira", "Kira", `could you fit me in ${asked(half)}?`, 9);
  await agent.draftForUnanswered(5, 60);
  const kira = systemFor(asked(half));
  check(`${label(half)} reads free from 1pm, half day yes, full day no`,
    kira.includes(`- ${label(half)}: short sitting from 1pm, half day from 1pm, no full day.`),
    (kira.match(/THE DATES THIS CUSTOMER ASKED ABOUT[\s\S]{0,400}/) ?? [""])[0]);
  check("the calendar was read once for both drafts, not five times each", icsHits === 1, `${icsHits} reads`);

  // Someone who named no date gets no such section.
  bodies = [];
  await customer("liv", "Liv", "how much for a small rose on my wrist?", 7);
  await agent.draftForUnanswered(5, 60);
  const liv = systemFor("small rose on my wrist");
  check("no named date, no named-date section", liv.length > 0 && !liv.includes("THE DATES THIS CUSTOMER ASKED ABOUT, each looked up"), liv.slice(0, 200));

  /* ---------- 3. the lines themselves ---------- */
  const sunday = civil(k + 1);
  const lines = await calendar.namedDatesForPrompt([
    `${asked(booked)}, or Sunday ${ord(sunday.day)} ${MONTHS[sunday.month]}, or anything in ${MONTHS[civil(150).month]}`,
  ]);
  check("a Sunday is closed, and said so", lines.includes(`- Sunday ${sunday.day} ${MONTHS[sunday.month]}${sunday.year !== today.year ? ` ${sunday.year}` : ""}: the studio is closed on Sundays.`), lines);
  check("a named month lists its open days", new RegExp(`- ${MONTHS[civil(150).month]}.*: something open on `).test(lines), lines);
  const far = await calendar.namedDatesForPrompt(["what about Saturday 3rd April 2027?"], new Date("2026-10-02T01:00:00Z"));
  check("six months out is still looked at", /Saturday 3 April 2027: /.test(far) && !/hasn't been checked/.test(far), far);
  const tooFar = await calendar.namedDatesForPrompt(["the 1st of September 2027"], new Date("2026-10-02T01:00:00Z"));
  check("past six months it says so, not free or booked", /hasn't been checked/.test(tooFar), tooFar);
  await sql.query("DELETE FROM timely_config");
  check("no calendar, no lines — never a guess", (await calendar.namedDatesForPrompt([asked(booked)])) === "");
} catch (error) {
  failures++;
  console.error("FAIL  the suite threw:", error);
} finally {
  ics.close();
  model.close();
  await sql.end();
}

if (failures) {
  console.log(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll named-date checks passed.");
process.exit(0);
