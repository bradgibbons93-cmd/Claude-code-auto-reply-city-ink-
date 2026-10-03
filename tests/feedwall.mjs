// Five days of live logs, 26 September:
//
//   02:07 [Feed] Sync failed ... requires the 'pages_read_engagement' permission
//   03:07 [Feed] Sync failed ... requires the 'pages_read_engagement' permission
//   ... every hour, ~120 times, each one 900 characters naming three edges
//
// The Live feed needs a permission Meta has not granted, so the hourly sync
// could never succeed — and asked anyway, forever. Nothing Brad can do
// changes that answer, and the next genuine fault would have been buried in
// it. That is the "red makes real faults unreadable" lesson, third time.
import http from "node:http";

// The repo root, wherever it has been cloned — these run from a checkout, not a fixed path.
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
process.env.DATABASE_URL ||= "mysql://ci:ci@127.0.0.1:3306/cityink";
process.env.FACEBOOK_GRAPH_URL = "http://127.0.0.1:4430";

let mode = "blocked";      // what the stand-in Graph answers
let postCalls = 0;         // how many times it was actually asked

const graph = http.createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (/debug_token/.test(req.url)) {
    return res.end(JSON.stringify({ data: { app_id: "111", is_valid: true, scopes: [] } }));
  }
  if (/published_posts|\/me\/feed|\/me\/posts/.test(req.url)) {
    postCalls++;
    if (mode === "blocked") {
      res.statusCode = 400;
      return res.end(JSON.stringify({
        error: {
          message: "(#10) This endpoint requires the 'pages_read_engagement' permission or the 'Page Public Content Access' feature.",
          type: "OAuthException", code: 10, fbtrace_id: "Atest",
        },
      }));
    }
    return res.end(JSON.stringify({ data: [] }));
  }
  res.end(JSON.stringify({ data: [] }));
});
await new Promise((r) => graph.listen(4430, r));

const db = await import(`${ROOT}/dist/server/db.js`);
const { ensureTables } = await import(`${ROOT}/dist/server/migrate.js`);
await ensureTables();
const { syncFeed } = await import(`${ROOT}/dist/server/feed.js`);

let failures = 0;
const check = (n, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};

await db.setFacebookConfig({
  pageId: "P", pageAccessToken: "tok", appId: "111",
  appSecret: "s", webhookVerifyToken: "v",
});

/* ---------- 1. the first refusal is said in full ---------- */
postCalls = 0;
let r = await syncFeed(14);
check("the first refusal really does ask Graph", postCalls > 0, `${postCalls} call(s)`);
check("and it names the permission rather than guessing",
  /pages_read_engagement/i.test(r.detail), r.detail.slice(0, 120));
check("and it does NOT claim the token expired",
  !/expired/i.test(r.detail), r.detail.slice(0, 160));

/* ---------- 2. the hourly retry stops ---------- */
postCalls = 0;
r = await syncFeed(14);
check("the next hourly run makes NO Graph call at all",
  postCalls === 0, `${postCalls} call(s) — still hammering`);
check("and says what it is waiting for",
  /Waiting on Meta|pages_read_engagement/i.test(r.detail), r.detail.slice(0, 140));
check("and tells the studio how to try anyway",
  /Refresh/i.test(r.detail), r.detail.slice(0, 200));

postCalls = 0;
for (let i = 0; i < 12; i++) await syncFeed(14);   // twelve hours of cron
check("twelve more hourly runs make no calls either",
  postCalls === 0, `${postCalls} call(s)`);

/* ---------- 3. pressing Refresh ignores the back-off ---------- */
postCalls = 0;
r = await syncFeed(14, true);
check("pressing Refresh asks Graph straight away",
  postCalls > 0, "the button did nothing");

/* ---------- 4. it recovers by itself when Meta grants it ---------- */
mode = "ok";
postCalls = 0;
r = await syncFeed(14, true);          // the Refresh that finds it working
check("a working feed clears the back-off", postCalls > 0, "no call made");
postCalls = 0;
r = await syncFeed(14);                // the next ordinary hourly run
check("and the hourly refresh resumes with no button press",
  postCalls > 0, "still resting after the permission landed");
check("and reports the sync rather than the wall",
  !/Waiting on Meta/i.test(r.detail), r.detail.slice(0, 120));

await new Promise((res) => graph.close(res));
console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
