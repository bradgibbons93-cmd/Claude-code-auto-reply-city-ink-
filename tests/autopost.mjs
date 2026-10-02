// An artist's upload becomes a post with the logo on, waiting for the OK.
//
// Brad, 2 October: "when an artist uploads a photo into that upload section,
// I want that to trigger ... adds the tattoo studio logo over their images
// and retouches the colour. If it could then put it into the scheduler with a
// simple caption same as all our other posts, that would be amazing."
//
// What must hold, and what this proves against the real server:
//   - the upload route makes a post per photo, with the studio's own logo
//     actually drawn on it, and a caption written by a model that SAW the
//     photo and was shown the studio's own recent captions;
//   - it lands as "review", which the publisher never touches, on the next
//     free day at the posting time ON THE STUDIO'S CLOCK (Railway is UTC);
//   - a re-sent photo, the five-minute sweep and the upload route can never
//     make two posts of one photo, and the back catalogue is never swept;
//   - approve, edit and remove behave, and removing hands the photo back;
//   - a model that's down, or a studio with no logo, still gets a post.
//
// Runs the built server (npm run build first) against a real database, on
// UTC like Railway.
import http from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

process.env.TZ = "UTC";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(`${ROOT}/package.json`);
const sharp = require("sharp");

const DATABASE_URL = process.env.DATABASE_URL || "mysql://ci:ci@127.0.0.1:3306/cityink";
const PORT = 4660 + Math.floor(Math.random() * 150);
const MODEL_PORT = 4840 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const CLAIM = "auto-post-claim";

// The test process imports the same modules for the sweep and the date maths.
process.env.DATABASE_URL = DATABASE_URL;
process.env.LLM_PROVIDER = "anthropic";
process.env.LLM_BASE_URL = `http://127.0.0.1:${MODEL_PORT}`;
process.env.LLM_API_KEY = "sk-ant-test";
process.env.LLM_MODEL = "claude-sonnet-5";

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- a stand-in model that remembers what it was shown ---------- */
let captionCalls = [];
let modelDown = false;
const model = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch {}
    const isCaption = String(body.system ?? "").includes("You write Facebook captions");
    if (isCaption) {
      captionCalls.push(body);
      if (modelDown) {
        res.statusCode = 529;
        return res.end(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }));
      }
      return res.end(JSON.stringify({
        content: [{ type: "text", text: JSON.stringify({ caption: "Fine line hearts, fresh off the table. Tattooed by Mim." }) }],
        stop_reason: "end_turn",
      }));
    }
    res.end(JSON.stringify({ content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", data: [{ id: "claude-sonnet-5" }] }));
  });
});
await new Promise((r) => model.listen(MODEL_PORT, r));

/* ---------- pictures ---------- */
// A "photo": muted blue-grey with a little texture, so retouching is measurable.
async function photo(seed = 0) {
  const w = 1200, h = 1600;
  const px = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const n = ((i * 2654435761 + seed * 97) >>> 0) % 23;
    px[i * 3] = 96 + n;
    px[i * 3 + 1] = 112 + n;
    px[i * 3 + 2] = 136 + n;
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}
// A logo: a solid red bar on transparency, so where it landed can be read back.
const logo = await sharp({ create: { width: 400, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp({ create: { width: 400, height: 100, channels: 3, background: { r: 230, g: 20, b: 20 } } }).png().toBuffer(), left: 0, top: 0 }])
  .png()
  .toBuffer();
const dataUrl = (bytes, type = "image/jpeg") => `data:${type};base64,${bytes.toString("base64")}`;
async function pixel(bytes, x, y) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2], width: info.width, height: info.height };
}
const isRed = (p) => p.r > 170 && p.g < 90 && p.b < 90;
// The centre of a medium logo in the bottom right of the 1080 square:
// 0.42 x 1080 = 454 wide, 114 tall, 49px in from each edge.
const SQ_LOGO = { x: 1080 - 49 - 227, y: 1080 - 49 - 57 };
/**
 * The average colour of a patch — one pixel of a JPEG is too noisy to compare.
 * Cut out FIRST: sharp's stats() reads the whole image whatever extract()
 * says, so measuring in one pipeline averages in the red logo and reads as a
 * colour shift that isn't there.
 */
async function patch(bytes, left, top, size = 120) {
  const cut = await sharp(bytes).extract({ left, top, width: size, height: size }).png().toBuffer();
  const { channels } = await sharp(cut).stats();
  return { r: channels[0].mean, g: channels[1].mean, b: channels[2].mean };
}
const satOf = (p) => Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);

/* ---------- the database, as Railway's would be before this shipped ---------- */
const mysql = (await import(`${ROOT}/node_modules/mysql2/promise.js`)).default;
const sql = await mysql.createConnection(DATABASE_URL);
for (const table of [
  "sessions", "studio_members", "studios", "brand_assets", "users", "app_settings",
  "scheduled_posts", "artist_uploads", "message_attachments", "facebook_config",
]) {
  await sql.query(`DELETE FROM ${table}`).catch(() => {});
}
// Railway's table has no 'review' in the enum and no upload_id. Put it back
// that way, so the boot has to fix it the way it will in production.
await sql.query("ALTER TABLE scheduled_posts MODIFY COLUMN status ENUM('draft','scheduled','published','failed') NOT NULL DEFAULT 'scheduled'").catch(() => {});
await sql.query("ALTER TABLE scheduled_posts DROP COLUMN upload_id").catch(() => {});
for (const c of ["auto_post_state", "auto_post_at", "auto_post_error"]) {
  await sql.query(`ALTER TABLE artist_uploads DROP COLUMN ${c}`).catch(() => {});
}
await sql.query(
  `INSERT INTO facebook_config (page_id, page_name, page_access_token, app_id, app_secret, webhook_verify_token, is_configured)
   VALUES ('P1', 'City Ink Tattoo', 'tok', 'app', 'secret', 'verify', 1)`
);
// The studio's own recent captions — the style the auto-post should copy.
await sql.query(
  `INSERT INTO scheduled_posts (content, scheduled_at, status) VALUES
   ('Fresh out of the studio. City Ink Tattoo, Geelong.', NOW() - INTERVAL 3 DAY, 'published'),
   ('Healed and settled. Book in through the link in bio.', NOW() - INTERVAL 2 DAY, 'published')`
);
// The back catalogue: in the gallery since before the feature existed.
const BACKLOG = "b".repeat(40);
await sql.query(
  "INSERT INTO artist_uploads (id, artist_name, content_type, bytes, created_at) VALUES (?, 'Mim', 'image/jpeg', ?, NOW() - INTERVAL 2 HOUR)",
  [BACKLOG, await photo(9)]
);

const server = spawn("node", ["dist/server/index.js"], {
  cwd: ROOT,
  env: {
    ...process.env,
    TZ: "UTC",
    PORT: String(PORT),
    DATABASE_URL,
    DASHBOARD_PASSWORD: CLAIM,
    PUBLIC_SIGNUP: "open",
    FACEBOOK_GRAPH_URL: "http://127.0.0.1:1",
    NODE_ENV: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${BASE}/health`)).ok && /Schema ready/.test(serverLog)) break;
  } catch {}
  await sleep(250);
}

function browser() {
  let cookie = "";
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const [name, value] = pair.split("=");
      if (name === "runnit_session") cookie = value ? `runnit_session=${value}` : "";
    }
    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("image/")) return { status: res.status, type, bytes: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, type };
  };
  return {
    query: async (proc, input) => {
      const q = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
      const r = await call("GET", `/api/trpc/${proc}${q}`);
      return { status: r.status, data: r.json?.result?.data, error: r.json?.error?.message ?? r.json?.error?.json?.message };
    },
    mutate: async (proc, input) => {
      const r = await call("POST", `/api/trpc/${proc}`, input ?? {});
      return { status: r.status, data: r.json?.result?.data, error: r.json?.error?.message ?? r.json?.error?.json?.message };
    },
    raw: call,
  };
}

async function reviewPosts() {
  const [rows] = await sql.query("SELECT * FROM scheduled_posts WHERE status = 'review' ORDER BY scheduled_at, id");
  return rows;
}
async function waitFor(fn, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await sleep(200);
  }
  return fn();
}
const dayOf = (d) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
const melbourne = (d) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(d));

try {
  /* ---------- the boot fixed Railway's table ---------- */
  const [[enumRow]] = await sql.query(
    "SELECT COLUMN_TYPE AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'scheduled_posts' AND column_name = 'status'"
  );
  check("boot adds 'review' to an existing scheduled_posts", String(enumRow?.t).includes("'review'"), enumRow?.t);

  /* ---------- Brad, with City Ink and its logo ---------- */
  const brad = browser();
  await brad.mutate("account.signup", { name: "Brad", email: "brad@example.com", password: "correct horse" });
  const claim = await brad.mutate("studios.claim", { code: CLAIM });
  const studioId = claim.data?.id;
  const up = await brad.raw("POST", "/api/brand", { kind: "logo", dataUrl: dataUrl(logo, "image/png") });
  await brad.mutate("studios.setImage", { id: studioId, which: "logo", assetId: up.json?.id });

  const settings = await brad.query("autopost.get");
  check("on by default, at 11am, bottom right, light touch-up",
    settings.data?.enabled === true && settings.data?.time === "11:00" &&
      settings.data?.look?.corner === "bottom-right" && settings.data?.look?.size === "medium" && settings.data?.look?.retouch === "light",
    JSON.stringify(settings));
  check("and it knows the studio has a logo", settings.data?.hasLogo === true, JSON.stringify(settings.data));
  check("a stranger can't read the settings", (await browser().query("autopost.get")).status === 401);

  /* ---------- Mim sends two photos from the wall ---------- */
  const artist = browser();
  const photoA = await photo(1);
  const photoB = await photo(2);
  const sent = await artist.raw("POST", "/api/uploads", {
    artistName: "Mim",
    note: "fine line hearts",
    photos: [{ contentType: "image/jpeg", dataUrl: dataUrl(photoA) }, { contentType: "image/jpeg", dataUrl: dataUrl(photoB) }],
  });
  check("the upload page still just says saved", sent.status === 200 && sent.json?.saved === 2, JSON.stringify(sent.json));

  const made = await waitFor(async () => ((await reviewPosts()).length >= 2 ? reviewPosts() : null));
  check("each photo became a post waiting for the OK", made?.length === 2, JSON.stringify(made?.map((p) => p.status)));
  const [uploads] = await sql.query("SELECT id, used_at, auto_post_state FROM artist_uploads WHERE id <> ? ORDER BY created_at", [BACKLOG]);
  const uploadIds = new Set(uploads.map((u) => u.id));
  check("each post knows which upload it came from", made?.every((p) => uploadIds.has(p.upload_id)) && new Set(made.map((p) => p.upload_id)).size === 2);
  check("the uploads are marked used and done",
    uploads.every((u) => u.used_at && u.auto_post_state === "done"), JSON.stringify(uploads));
  check("the back catalogue was left alone",
    !(await reviewPosts()).some((p) => p.upload_id === BACKLOG));

  /* the picture */
  const first = made[0];
  check("the post's picture is a new image, not the raw upload", /^\/api\/attachments\/[0-9a-f]{40}$/.test(first.image_url ?? ""), first.image_url);
  const pic = await brad.raw("GET", first.image_url);
  check("it's a JPEG the studio can open", pic.status === 200 && pic.type === "image/jpeg", `${pic.status} ${pic.type}`);
  // Bottom right, medium: 0.42 of 1080 wide → 454x114, 49px in.
  const onLogo = await pixel(pic.bytes, SQ_LOGO.x, SQ_LOGO.y);
  const farCorner = await pixel(pic.bytes, 80, 80);
  check("the studio's logo is drawn in the bottom right", isRed(onLogo), JSON.stringify(onLogo));
  check("and nowhere near the top left", !isRed(farCorner), JSON.stringify(farCorner));
  check("the post is a 1080 square", onLogo.width === 1080 && onLogo.height === 1080, `${onLogo.width}x${onLogo.height}`);

  /* the story */
  check("each post comes with a story", /^\/api\/attachments\/[0-9a-f]{40}$/.test(first.story_url ?? "") && first.story_url !== first.image_url, first.story_url);
  const storyPic = await brad.raw("GET", first.story_url);
  const storyLogo = await pixel(storyPic.bytes, SQ_LOGO.x, 1920 - 230 - 57);
  check("the story is 1080 x 1920", storyLogo.width === 1080 && storyLogo.height === 1920, `${storyLogo.width}x${storyLogo.height}`);
  check("with the logo clear of Instagram's reply bar", isRed(storyLogo) && !isRed(await pixel(storyPic.bytes, SQ_LOGO.x, SQ_LOGO.y + 840)), JSON.stringify(storyLogo));
  const band = await patch(storyPic.bytes, 480, 60);
  const middle = await patch(storyPic.bytes, 480, 900);
  const lum = (p) => p.r + p.g + p.b;
  check("a 3:4 photo is shown whole, over a darker soft backdrop", lum(band) < lum(middle) * 0.8,
    `band ${JSON.stringify(band)} vs photo ${JSON.stringify(middle)}`);
  check("a stranger can't open the story either", (await browser().raw("GET", first.story_url)).status === 401);
  const original = await patch(photoA, 200, 200);
  const touched = await patch(pic.bytes, 200, 200);
  check("the colour was touched up (a little more saturated)", satOf(touched) > satOf(original) + 1,
    `${JSON.stringify(original)} → ${JSON.stringify(touched)}`);
  check("a stranger can't open the branded photo", (await browser().raw("GET", first.image_url)).status === 401);

  /* the caption */
  check("the caption is the one the model wrote", first.content === "Fine line hearts, fresh off the table. Tattooed by Mim." && first.ai_generated === 1, first.content);
  const call = captionCalls[0];
  const turn = JSON.stringify(call?.messages ?? []);
  check("the model was shown the photo", turn.includes('"type":"image"'), turn.slice(0, 200));
  check("and told who tattooed it", turn.includes("tattooed by Mim"));
  check("and given the artist's note", turn.includes("fine line hearts"));
  check("and the studio's own recent captions to match", turn.includes("Healed and settled. Book in through the link in bio."));

  /* the day */
  const times = made.map((p) => melbourne(p.scheduled_at));
  check("both go out at 11:00 on the studio's clock, not the server's",
    times.every((t) => /11:00/.test(t)), JSON.stringify(times));
  check("on two different days", new Set(made.map((p) => dayOf(p.scheduled_at))).size === 2, JSON.stringify(times));
  check("both in the future", made.every((p) => new Date(p.scheduled_at) > new Date()));

  /* the phone */
  check("the phone is told there are posts to check", /new posts ready to check/.test(serverLog), serverLog.split("\n").filter((l) => l.includes("Push")).join(" | "));

  /* ---------- the publisher never touches a post nobody approved ---------- */
  const db = await import(`${ROOT}/dist/server/db.js`);
  await sql.query("UPDATE scheduled_posts SET scheduled_at = NOW() - INTERVAL 1 MINUTE WHERE id = ?", [first.id]);
  const due = await db.getDuePosts();
  check("a 'review' post whose time has come is NOT due", !due.some((p) => p.id === first.id), JSON.stringify(due.map((p) => p.id)));
  await sql.query("UPDATE scheduled_posts SET scheduled_at = ? WHERE id = ?", [first.scheduled_at, first.id]);

  /* ---------- the same photo sent again ---------- */
  const again = await artist.raw("POST", "/api/uploads", { artistName: "Mim", photos: [{ contentType: "image/jpeg", dataUrl: dataUrl(photoA) }] });
  await sleep(1500);
  check("a re-sent photo is not a second post", again.json?.saved === 1 && (await reviewPosts()).length === 2, String((await reviewPosts()).length));

  /* ---------- approve ---------- */
  const posts = await brad.query("posts.getScheduled");
  check("Posts lists them with their status", posts.data?.filter((p) => p.status === "review").length === 2);
  const ok = await brad.mutate("posts.approve", { id: first.id });
  const [[afterOk]] = await sql.query("SELECT * FROM scheduled_posts WHERE id = ?", [first.id]);
  check("Approve makes it an ordinary scheduled post", ok.status === 200 && afterOk.status === "scheduled", JSON.stringify(ok));
  check("on the day it was already given", new Date(afterOk.scheduled_at).getTime() === new Date(first.scheduled_at).getTime());
  const twice = await brad.mutate("posts.approve", { id: first.id });
  check("approving twice is refused in words", twice.status === 400 && /already been dealt with/.test(twice.error ?? ""), JSON.stringify(twice));

  const second = made[1];
  const edited = await brad.mutate("posts.approve", {
    id: second.id,
    content: "  Swing set hearts by Mim.  ",
    scheduledAt: new Date(Date.now() - 3600_000).toISOString(),
  });
  const [[afterEdit]] = await sql.query("SELECT * FROM scheduled_posts WHERE id = ?", [second.id]);
  check("Approve with a new caption keeps the edit, trimmed", afterEdit.content === "Swing set hearts by Mim.", afterEdit.content);
  check("and it no longer counts as AI-written", afterEdit.ai_generated === 0);
  check("a time already gone moves it to a free day, not out the door now",
    new Date(afterEdit.scheduled_at) > new Date() && /11:00/.test(melbourne(afterEdit.scheduled_at)) &&
      dayOf(afterEdit.scheduled_at) !== dayOf(afterOk.scheduled_at),
    `${melbourne(afterEdit.scheduled_at)} vs ${melbourne(afterOk.scheduled_at)}`);
  check("a stranger can't approve anything", (await browser().mutate("posts.approve", { id: second.id })).status === 401);

  /* ---------- remove hands the photo back ---------- */
  const third = await artist.raw("POST", "/api/uploads", { artistName: "Jay", photos: [{ contentType: "image/jpeg", dataUrl: dataUrl(await photo(3)) }] });
  const thirdPost = await waitFor(async () => (await reviewPosts()).find((p) => !made.some((m) => m.id === p.id)));
  check("a third photo is a third post", third.json?.saved === 1 && !!thirdPost);
  const removed = await brad.mutate("posts.remove", { id: thirdPost?.id });
  const [[thirdUpload]] = await sql.query("SELECT used_at, auto_post_state FROM artist_uploads WHERE id = ?", [thirdPost?.upload_id]);
  check("Remove deletes the post", removed.status === 200 && !(await reviewPosts()).some((p) => p.id === thirdPost?.id));
  check("and puts the photo back in the gallery as unused", thirdUpload?.used_at === null, JSON.stringify(thirdUpload));
  check("but never makes it into a post again by itself", thirdUpload?.auto_post_state === "done");

  /* ---------- the sweep under the upload route ---------- */
  const autopost = await import(`${ROOT}/dist/server/autopost.js`);
  const MISSED = "c".repeat(40);
  const STUCK = "d".repeat(40);
  await sql.query("INSERT INTO artist_uploads (id, artist_name, content_type, bytes, created_at) VALUES (?, 'Mim', 'image/jpeg', ?, NOW())", [MISSED, await photo(4)]);
  await sql.query(
    "INSERT INTO artist_uploads (id, artist_name, content_type, bytes, created_at, auto_post_state, auto_post_at) VALUES (?, 'Mim', 'image/jpeg', ?, NOW(), 'working', NOW() - INTERVAL 20 MINUTE)",
    [STUCK, await photo(5)]
  );
  await autopost.sweepAutoPosts();
  const swept = await reviewPosts();
  check("the sweep makes a post the route missed", swept.some((p) => p.upload_id === MISSED));
  check("and finishes one a crash left half-made", swept.some((p) => p.upload_id === STUCK));
  check("and still leaves the back catalogue alone", !swept.some((p) => p.upload_id === BACKLOG));
  const count = swept.length;
  await autopost.sweepAutoPosts();
  await autopost.autoPostUploads([MISSED, STUCK]);
  check("sweeping again, or calling the route again, makes nothing new", (await reviewPosts()).length === count, String((await reviewPosts()).length));

  /* ---------- days stay one a day ---------- */
  const [allQueued] = await sql.query("SELECT scheduled_at FROM scheduled_posts WHERE status IN ('review','scheduled') AND scheduled_at > NOW()");
  const days = allQueued.map((r) => dayOf(r.scheduled_at));
  check("no two queued posts share a day", new Set(days).size === days.length, JSON.stringify(days));

  /* ---------- the model is down ---------- */
  modelDown = true;
  await artist.raw("POST", "/api/uploads", { artistName: "Mim", note: "", photos: [{ contentType: "image/jpeg", dataUrl: dataUrl(await photo(6)) }] });
  const before = new Set(swept.map((p) => p.id));
  const fallback = await waitFor(async () => (await reviewPosts()).find((p) => !before.has(p.id)), 90000);
  check("a model that's down still gets a post", !!fallback);
  check("with a stock line and the artist's credit", /Tattooed by Mim\.$/.test(fallback?.content ?? "") && fallback?.ai_generated === 0, fallback?.content);
  modelDown = false;

  /* ---------- no logo ---------- */
  await sql.query("UPDATE studios SET logo_asset_id = NULL");
  const noLogoSettings = await brad.query("autopost.get");
  check("without a logo the settings say so", noLogoSettings.data?.hasLogo === false);
  const known = new Set((await reviewPosts()).map((p) => p.id));
  await artist.raw("POST", "/api/uploads", { artistName: "Mim", photos: [{ contentType: "image/jpeg", dataUrl: dataUrl(await photo(7)) }] });
  const plain = await waitFor(async () => (await reviewPosts()).find((p) => !known.has(p.id)));
  const plainPic = plain ? await brad.raw("GET", plain.image_url) : undefined;
  check("a studio with no logo still gets the post, touched up", !!plain && plainPic?.status === 200);
  check("with nothing drawn in the corner", plainPic ? !isRed(await pixel(plainPic.bytes, SQ_LOGO.x, SQ_LOGO.y)) : false);

  /* ---------- the switch ---------- */
  const off = await brad.mutate("autopost.save", { enabled: false });
  check("it can be switched off", off.status === 200 && off.data?.enabled === false, JSON.stringify(off));
  const beforeOff = (await reviewPosts()).length;
  const whileOff = await artist.raw("POST", "/api/uploads", { artistName: "Mim", photos: [{ contentType: "image/jpeg", dataUrl: dataUrl(await photo(8)) }] });
  await sleep(1500);
  check("off means an upload is just an upload", whileOff.json?.saved === 1 && (await reviewPosts()).length === beforeOff);
  await brad.mutate("autopost.save", { enabled: true });
  await autopost.sweepAutoPosts();
  check("switching it back on doesn't sweep what came in while it was off", (await reviewPosts()).length === beforeOff, String((await reviewPosts()).length));

  /* ---------- a logo just for posts ---------- */
  // Brad's white "official" logo: right on a photo, invisible on a light app
  // theme, so it is kept apart from the studio's app logo.
  const blue = await sharp({ create: { width: 400, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 400, height: 100, channels: 3, background: { r: 20, g: 40, b: 230 } } }).png().toBuffer(), left: 0, top: 0 }])
    .png()
    .toBuffer();
  const isBlue = (p) => p.b > 170 && p.r < 90 && p.g < 110;
  const upPost = await brad.raw("POST", "/api/brand", { kind: "postlogo", dataUrl: dataUrl(blue, "image/png") });
  check("a logo for posts uploads", upPost.status === 200 && /^[0-9a-f]{40}$/.test(upPost.json?.id ?? ""), JSON.stringify(upPost.json));
  const setLogo = await brad.mutate("autopost.save", { logoAssetId: upPost.json?.id });
  const withLogo = await brad.query("autopost.get");
  check("and is chosen for posts", setLogo.status === 200 && withLogo.data?.customLogo === true && withLogo.data?.logoUrl === `/api/brand/${upPost.json?.id}`, JSON.stringify(withLogo.data));
  const studioAfter = (await brad.query("account.me")).data?.studios?.find((x) => x.id === studioId);
  check("without touching the studio's own logo in the app", studioAfter?.logoUrl !== `/api/brand/${upPost.json?.id}`, JSON.stringify(studioAfter?.logoUrl));
  const before2 = new Set((await reviewPosts()).map((p) => p.id));
  await artist.raw("POST", "/api/uploads", { artistName: "Mim", photos: [{ contentType: "image/jpeg", dataUrl: dataUrl(await photo(11)) }] });
  const withPostLogo = await waitFor(async () => (await reviewPosts()).find((p) => !before2.has(p.id)));
  const postPic = withPostLogo ? await brad.raw("GET", withPostLogo.image_url) : undefined;
  check("the next post wears the post logo", postPic ? isBlue(await pixel(postPic.bytes, SQ_LOGO.x, SQ_LOGO.y)) : false);
  const stranger = browser();
  await stranger.mutate("account.signup", { name: "Someone", email: "someone@example.com", password: "another pass" });
  const theirs = await stranger.raw("POST", "/api/brand", { kind: "postlogo", dataUrl: dataUrl(blue, "image/png") });
  const stolen = await brad.mutate("autopost.save", { logoAssetId: theirs.json?.id });
  check("someone else's image can't be made the post logo", stolen.status === 403, JSON.stringify(stolen));
  await brad.mutate("autopost.save", { logoAssetId: null });
  check("and it can go back to the studio logo", (await brad.query("autopost.get")).data?.customLogo === false);

  /* ---------- the nightly clear-out keeps the story ---------- */
  const hk = await import(`${ROOT}/dist/server/housekeeping.js`);
  await hk.pruneStoredImages({ now: new Date(Date.now() + 60 * 86_400_000), orphanGraceDays: 0 });
  check("the 2am clear-out never takes a post's story", (await brad.raw("GET", first.story_url)).status === 200);
  check("or its square", (await brad.raw("GET", first.image_url)).status === 200);

  /* ---------- the look ---------- */
  const look = await brad.mutate("autopost.save", { look: { corner: "top-left", size: "large", retouch: "off" }, time: "18:30" });
  check("the look and the time save", look.data?.look?.corner === "top-left" && look.data?.time === "18:30", JSON.stringify(look.data));
  const badTime = await brad.mutate("autopost.save", { time: "25:00" });
  check("a time that isn't one is refused", badTime.status === 400);
  const preview = await brad.raw("GET", "/api/post-look/preview?corner=top-left&size=large&retouch=off");
  check("the preview draws the template for the studio", preview.status === 200 && preview.type === "image/jpeg");
  check("and only for the studio", (await browser().raw("GET", "/api/post-look/preview")).status === 401);

  /* ---------- the template on its own ---------- */
  const offLook = await autopost.brandPhoto(photoA, { corner: "top-left", size: "small", retouch: "off" }, logo);
  const tl = await pixel(offLook.bytes, 49 + 20, 49 + 10);
  check("top left puts it top left", isRed(tl), JSON.stringify(tl));
  const untouched = await patch(offLook.bytes, 500, 800);
  const raw = await patch(photoA, 500, 800);
  check("'None' leaves the colour alone",
    Math.abs(untouched.r - raw.r) < 1.5 && Math.abs(untouched.g - raw.g) < 1.5 && Math.abs(untouched.b - raw.b) < 1.5,
    `${JSON.stringify(raw)} → ${JSON.stringify(untouched)}`);
  const centre = await autopost.brandPhoto(photoA, { corner: "bottom-centre", size: "medium", retouch: "light" }, logo);
  check("bottom middle is centred", isRed(await pixel(centre.bytes, 540, SQ_LOGO.y)));
  check("a phone's 3:4 photo fills the square (cropped, not shrunk)", centre.filled === true);
  const wide = await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg().toBuffer();
  const wideSquare = await autopost.brandPhoto(wide, { corner: "bottom-right", size: "medium", retouch: "off" }, logo, "square");
  check("a wide 16:9 photo is shown whole in the square instead", wideSquare.filled === false && wideSquare.width === 1080 && wideSquare.height === 1080);
  const tall = await sharp({ create: { width: 900, height: 1600, channels: 3, background: { r: 120, g: 110, b: 100 } } }).jpeg().toBuffer();
  check("a photo already 9:16 fills the story", (await autopost.brandPhoto(tall, { corner: "bottom-right", size: "medium", retouch: "off" }, logo, "story")).filled === true);
  const storyPreview = await brad.raw("GET", "/api/post-look/preview?format=story&corner=bottom-right&size=medium&retouch=light");
  const storyMeta = storyPreview.bytes ? await sharp(storyPreview.bytes).metadata() : {};
  check("the preview draws the story too", storyPreview.status === 200 && Math.abs(storyMeta.height / storyMeta.width - 1920 / 1080) < 0.02, JSON.stringify(storyMeta.width) + "x" + storyMeta.height);
  const broken = await autopost.brandPhoto(photoA, { corner: "bottom-right", size: "medium", retouch: "light" }, Buffer.from("not a png"));
  check("a logo that won't open costs the logo, not the post", broken.logoApplied === false && broken.bytes.length > 1000);

  /* ---------- the studio's clock (Railway is UTC) ---------- */
  const { planDates } = await import(`${ROOT}/dist/server/bulk.js`);
  const sat = new Date("2026-10-02T21:30:00Z"); // Saturday 3 October, 7:30am in Geelong
  const [d1] = planDates(1, { startDate: sat, timeOfDay: "11:00", now: sat });
  check("11am Saturday in Geelong is 01:00 UTC, not 11:00 UTC", d1?.toISOString() === "2026-10-03T01:00:00.000Z", d1?.toISOString());
  const mon = new Date("2026-10-04T20:00:00Z"); // Monday 5 October, after daylight saving starts
  const [d2] = planDates(1, { startDate: mon, timeOfDay: "11:00", now: mon });
  check("and keeps up with daylight saving", d2?.toISOString() === "2026-10-05T00:00:00.000Z", d2?.toISOString());
  const taken = new Set(["2026-10-3"]);
  const [d3] = planDates(1, { startDate: sat, timeOfDay: "11:00", now: sat, takenDays: taken });
  check("a booked day is stepped over on the studio's calendar", d3?.toISOString() === "2026-10-04T00:00:00.000Z", d3?.toISOString());
} catch (error) {
  failures++;
  console.error("FAIL  the suite threw:", error);
} finally {
  server.kill();
  model.close();
  await sql.end();
}

if (failures) {
  console.log(`\n${failures} failure(s). Server log tail:\n${serverLog.split("\n").slice(-40).join("\n")}`);
  process.exit(1);
}
console.log("\nAll auto-post checks passed.");
process.exit(0);
