// Five days of live logs, every few minutes:
//
//   [Facebook] No name for 1634877124875070 — HTTP 403: (#230) User consent
//              is required to access user profile
//   [Facebook] No name for 1107893608468299 — HTTP 400: (#9010) No matching
//              Instagram user
//
// Neither was on profileRefusalIsPermanent's list, so neither ever earned the
// hour-long back-off. Five threads, asked over and over, for answers that can
// never change.
//
// They are permanent in DIFFERENT ways, and that is the whole point:
//   (#230)  is about the APP    — same answer for everyone, back off the platform
//   (#9010) is about the PERSON — a deleted account, so remember just them
// Treating #9010 as an app-level refusal would stop the app naming everybody
// else because one customer deleted their account.
import http from "node:http";

// The repo root, wherever it has been cloned — these run from a checkout, not a fixed path.
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
process.env.DATABASE_URL ||= "mysql://ci:ci@127.0.0.1:3306/cityink";
process.env.FACEBOOK_GRAPH_URL = "http://127.0.0.1:4440";

const GONE = "1107893608468299";     // (#9010), from the live log
const CONSENT = "1634877124875070";  // (#230),  from the live log
const FINE = "5550001111";
const GONE_THREAD = "1107893608468300"; // (#9010) on the OTHER lookup path

const asked = new Map();
const graph = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");

  // getThreadParticipant asks a different way — /me/conversations?user_id=…
  // It is the other road to the same person, so it earns the same answers.
  const viaThread = (req.url.match(/\/me\/conversations\?.*\buser_id=(\d+)/) || [])[1];
  if (viaThread) {
    asked.set(viaThread, (asked.get(viaThread) ?? 0) + 1);
    if (viaThread === GONE_THREAD) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: "(#9010) No matching Instagram user", type: "OAuthException", code: 9010 } }));
    }
    return res.end(JSON.stringify({ data: [] }));
  }

  const id = (req.url.match(/^\/(\d+)\?/) || [])[1];
  if (!id) return res.end(JSON.stringify({ id: "PAGE", name: "City Ink" }));
  asked.set(id, (asked.get(id) ?? 0) + 1);
  if (id === GONE) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: { message: "(#9010) No matching Instagram user", type: "OAuthException", code: 9010 } }));
  }
  if (id === CONSENT) {
    res.statusCode = 403;
    return res.end(JSON.stringify({ error: { message: "(#230) User consent is required to access user profile", type: "OAuthException", code: 230 } }));
  }
  res.end(JSON.stringify({ name: "Real Customer", username: "realcustomer" }));
});
await new Promise((r) => graph.listen(4440, r));

const db = await import(`${ROOT}/dist/server/db.js`);
const { ensureTables } = await import(`${ROOT}/dist/server/migrate.js`);
await ensureTables();
const fb = await import(`${ROOT}/dist/server/facebook.js`);

let failures = 0;
const check = (n, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};

await db.setFacebookConfig({
  pageId: "PAGE", pageAccessToken: "tok", appId: "111",
  appSecret: "s", webhookVerifyToken: "v",
});

/* ---------- a deleted account is remembered, per person ---------- */
await fb.getSenderProfile(GONE, "instagram");
const afterFirst = asked.get(GONE);
check("a (#9010) lookup is actually attempted once", afterFirst >= 1, String(afterFirst));

for (let i = 0; i < 10; i++) await fb.getSenderProfile(GONE, "instagram");
check("and never asked about again",
  asked.get(GONE) === afterFirst, `asked ${asked.get(GONE)} times, was ${afterFirst}`);

/* ---------- and it must NOT silence everyone else ---------- */
const stillWorks = await fb.getSenderProfile(FINE, "instagram");
check("a different customer is still looked up normally",
  stillWorks?.name === "Real Customer", JSON.stringify(stillWorks));
check("which is the point: one deleted account must not mute the rest",
  (asked.get(FINE) ?? 0) >= 1, "never asked");

/* ---------- and the same on the other road to the same person ---------- */
// getThreadParticipant CHECKED profileGone but never wrote to it, so a
// (#9010) arriving here was retried for ever — the asymmetry is the bug.
await fb.getThreadParticipant(GONE_THREAD, "instagram");
const threadFirst = asked.get(GONE_THREAD) ?? 0;
check("the thread lookup asks once", threadFirst >= 1, String(threadFirst));

for (let i = 0; i < 10; i++) await fb.getThreadParticipant(GONE_THREAD, "instagram");
check("and then remembers, the same as the profile lookup does",
  asked.get(GONE_THREAD) === threadFirst, `asked ${asked.get(GONE_THREAD)} times`);

/* ---------- a consent refusal backs off the whole platform ---------- */
const before = asked.get(CONSENT) ?? 0;
await fb.getSenderProfile(CONSENT, "instagram");
const afterConsent = asked.get(CONSENT) ?? 0;
check("a (#230) lookup is attempted once", afterConsent > before, `${before} -> ${afterConsent}`);

for (let i = 0; i < 10; i++) await fb.getSenderProfile(CONSENT, "instagram");
check("and then the platform is left alone for an hour",
  asked.get(CONSENT) === afterConsent, `asked ${asked.get(CONSENT)} times`);

// That back-off is app-wide by design, so the good customer is quiet too now.
const fineBefore = asked.get(FINE) ?? 0;
await fb.getSenderProfile(FINE, "instagram");
check("the app-level back-off covers everyone, as intended",
  (asked.get(FINE) ?? 0) === fineBefore, "still asking during the back-off");

await new Promise((r) => graph.close(r));
console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
