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
for (const c of ["story_url", "framing", "look_key", "photo_style"]) {
  await sql.query(`ALTER TABLE scheduled_posts DROP COLUMN ${c}`).catch(() => {});
}
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
      settings.data?.look?.corner === "bottom-right" && settings.data?.look?.size === "medium" && settings.data?.look?.retouch === "light" &&
      settings.data?.look?.shadow === "soft",
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

  /* where the photo sits, recorded for the drag */
  const framed = JSON.parse(first.framing ?? "{}");
  check("each post records where its photo sits, square and story",
    framed.square?.fill === true && framed.square?.set === false && typeof framed.square?.y === "number" &&
      framed.story?.fill === false && framed.story?.set === false && framed.story?.y === 0.5,
    first.framing);
  check("and which look it was drawn in", /^[0-9a-f]{16}$/.test(first.look_key ?? ""), first.look_key);

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
  const uploadsBeforeOff = new Set((await sql.query("SELECT id FROM artist_uploads"))[0].map((r) => r.id));
  const whileOff = await artist.raw("POST", "/api/uploads", { artistName: "Mim", photos: [{ contentType: "image/jpeg", dataUrl: dataUrl(await photo(8)) }] });
  const sentWhileOff = (await sql.query("SELECT id FROM artist_uploads"))[0].map((r) => r.id).find((id) => !uploadsBeforeOff.has(id));
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

  /* ---------- the shadow (Brad: "the shadow on the logo is way to dark") ---------- */
  // A plain pale photo, so the only thing darkening it is the shadow. Measured
  // just under the logo's bottom edge, against a patch nowhere near it. The
  // old shadow darkened this strip by 34%: it said 60% black, but sharp ran
  // the fade before cutting out the alpha, so it was solid black, blurred.
  const pale = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 214, g: 196, b: 182 } } }).jpeg({ quality: 95 }).toBuffer();
  const lum3 = (p) => p.r + p.g + p.b;
  const shade = async (shadow) => {
    const out = await autopost.brandPhoto(pale, { corner: "bottom-right", size: "medium", retouch: "off", shadow }, logo, "square");
    return 1 - lum3(await patch(out.bytes, 700, 1034, 12)) / lum3(await patch(out.bytes, 100, 100, 60));
  };
  const [soft, strong, none] = [await shade("soft"), await shade("strong"), await shade("off")];
  check("the soft shadow (the default) barely darkens the skin round the logo", soft > 0.01 && soft < 0.1, soft.toFixed(3));
  check("strong is darker than soft, and still well short of the old one", strong > soft + 0.02 && strong < 0.25, `${strong.toFixed(3)} vs ${soft.toFixed(3)}`);
  check("and none is none", Math.abs(none) < 0.01, none.toFixed(3));
  const noShadowSave = await brad.mutate("autopost.save", { look: { shadow: "off" } });
  check("the shadow choice saves", noShadowSave.data?.look?.shadow === "off", JSON.stringify(noShadowSave.data));
  const badShadow = await brad.mutate("autopost.save", { look: { shadow: "pitch black" } });
  check("a shadow that isn't one of the three is refused", badShadow.status === 400);

  /* ---------- drag to move the photo (Brad: "drag to recenter the picture") ---------- */
  // The red logo back on the studio, in the bottom right, for the overlay.
  const reLogo = await brad.raw("POST", "/api/brand", { kind: "logo", dataUrl: dataUrl(logo, "image/png") });
  await brad.mutate("studios.setImage", { id: studioId, which: "logo", assetId: reLogo.json?.id });
  await brad.mutate("autopost.save", { look: { corner: "bottom-right", size: "medium", retouch: "off", shadow: "soft" } });

  // A photo with a green band across the top and a magenta one across the
  // bottom, so which part of it landed in the frame can be read back.
  const banded = (() => {
    const w = 1200, h = 1600;
    const px = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      const [r, g, b] = y < 300 ? [30, 200, 40] : y >= h - 300 ? [210, 30, 200] : [150, 140, 130];
      for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b; }
    }
    return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
  })();
  const isGreen = (p) => p.g > 150 && p.r < 110 && p.b < 110;
  const isMagenta = (p) => p.r > 150 && p.b > 140 && p.g < 110;
  // Found by the upload it came from, not as "whichever post is new": in a
  // full run another post can land in between and get picked up instead.
  const uploadsBefore = new Set((await sql.query("SELECT id FROM artist_uploads"))[0].map((r) => r.id));
  await artist.raw("POST", "/api/uploads", { artistName: "Mim", photos: [{ contentType: "image/jpeg", dataUrl: dataUrl(await banded) }] });
  const bandUpload = (await sql.query("SELECT id FROM artist_uploads"))[0].map((r) => r.id).find((id) => !uploadsBefore.has(id));
  const bandPost = await waitFor(async () => (await reviewPosts()).find((p) => p.upload_id === bandUpload));
  check("a banded photo makes a post to move", !!bandPost?.upload_id);

  const toTop = await brad.mutate("posts.reframe", { id: bandPost.id, square: { x: 0.5, y: 0 } });
  const [[atTop]] = await sql.query("SELECT * FROM scheduled_posts WHERE id = ?", [bandPost.id]);
  const topPic = (await brad.raw("GET", atTop.image_url)).bytes;
  check("dragging the square to the top shows the top of the photo",
    toTop.status === 200 && isGreen(await pixel(topPic, 540, 100)) && !isMagenta(await pixel(topPic, 200, 1040)),
    JSON.stringify(toTop.error ?? await pixel(topPic, 540, 100)));
  const topFraming = JSON.parse(atTop.framing);
  check("and it's remembered as placed by hand", topFraming.square?.set === true && topFraming.square?.y === 0 && topFraming.story?.set === false, atTop.framing);
  check("the new picture is a new image", atTop.image_url !== bandPost.image_url, `${bandPost.image_url} → ${atTop.image_url}`);
  check("with the logo still in the corner, drawn once", isRed(await pixel(topPic, SQ_LOGO.x, SQ_LOGO.y)));

  await brad.mutate("posts.reframe", { id: bandPost.id, square: { x: 0.5, y: 1 } });
  const [[atBottom]] = await sql.query("SELECT * FROM scheduled_posts WHERE id = ?", [bandPost.id]);
  const bottomPic = (await brad.raw("GET", atBottom.image_url)).bytes;
  check("and to the bottom shows the bottom",
    isMagenta(await pixel(bottomPic, 200, 1040)) && !isGreen(await pixel(bottomPic, 540, 100)),
    JSON.stringify(await pixel(bottomPic, 200, 1040)));

  // The story shows a 3:4 photo whole, so moving it slides it over the blur.
  await brad.mutate("posts.reframe", { id: bandPost.id, story: { x: 0.5, y: 0 } });
  const [[storyTop]] = await sql.query("SELECT * FROM scheduled_posts WHERE id = ?", [bandPost.id]);
  const storyTopPic = (await brad.raw("GET", storyTop.story_url)).bytes;
  check("the story can be moved too: up to the top edge",
    isGreen(await pixel(storyTopPic, 540, 60)) && !isMagenta(await pixel(storyTopPic, 540, 1860)),
    JSON.stringify(await pixel(storyTopPic, 540, 60)));
  check("without undoing the square's spot", JSON.parse(storyTop.framing).square?.y === 1, storyTop.framing);

  const reset = await brad.mutate("posts.reframe", { id: bandPost.id, square: null });
  const [[afterReset]] = await sql.query("SELECT framing FROM scheduled_posts WHERE id = ?", [bandPost.id]);
  check("Back to automatic hands the square back to sharp", reset.status === 200 && JSON.parse(afterReset.framing).square?.set === false &&
    JSON.parse(afterReset.framing).story?.set === true, afterReset.framing);
  await brad.mutate("posts.reframe", { id: bandPost.id, square: { x: 0.5, y: 0 } });

  check("a stranger can't move anyone's photo", (await browser().mutate("posts.reframe", { id: bandPost.id, square: { x: 0, y: 0 } })).status === 401);
  const approvedMove = await brad.mutate("posts.reframe", { id: first.id, square: { x: 0, y: 0 } });
  check("an approved post's photo is set", approvedMove.status === 400 && /already approved/.test(approvedMove.error ?? ""), JSON.stringify(approvedMove));
  const offFrame = await brad.mutate("posts.reframe", { id: bandPost.id, square: { x: 2, y: -1 } });
  check("a spot outside the frame is refused", offFrame.status === 400);

  /* the logo overlay laid over the drag */
  const overlay = await brad.raw("GET", "/api/post-look/overlay?format=story");
  const overlayMeta = overlay.bytes ? await sharp(overlay.bytes).metadata() : {};
  const ovLogo = overlay.bytes ? await sharp(overlay.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) : undefined;
  const alphaAt = (x, y) => ovLogo.data[(y * ovLogo.info.width + x) * 4 + 3];
  check("the drag gets the logo on its own, see-through, where the post has it",
    overlay.status === 200 && overlayMeta.width === 540 && overlayMeta.height === 960 && overlayMeta.hasAlpha &&
      alphaAt(Math.round(SQ_LOGO.x / 2), Math.round((1920 - 230 - 57) / 2)) > 200 && alphaAt(270, 300) === 0,
    `${overlay.status} ${overlayMeta.width}x${overlayMeta.height}`);
  check("and only the studio gets it", (await browser().raw("GET", "/api/post-look/overlay")).status === 401);

  /* ---------- changing the look redraws what's waiting ---------- */
  const [[beforeLook]] = await sql.query("SELECT * FROM scheduled_posts WHERE id = ?", [bandPost.id]);
  await brad.mutate("autopost.save", { look: { corner: "top-left" } });
  const redrawn = await waitFor(async () => {
    const [[row]] = await sql.query("SELECT * FROM scheduled_posts WHERE id = ?", [bandPost.id]);
    return row.look_key !== beforeLook.look_key ? row : null;
  }, 30000);
  const redrawnPic = redrawn ? (await brad.raw("GET", redrawn.image_url)).bytes : undefined;
  check("a waiting post is redrawn in the new look by itself",
    !!redrawn && redrawn.image_url !== beforeLook.image_url && isRed(await pixel(redrawnPic, 49 + 100, 49 + 40)),
    redrawn ? JSON.stringify(await pixel(redrawnPic, 49 + 100, 49 + 40)) : "never redrawn");
  check("keeping the spot it was dragged to",
    !!redrawn && JSON.parse(redrawn.framing).square?.set === true && isMagenta(await pixel(redrawnPic, 200, 1040)) === false &&
      isGreen(await pixel(redrawnPic, 700, 200)),
    redrawn?.framing);
  const [[stillApproved]] = await sql.query("SELECT image_url, look_key FROM scheduled_posts WHERE id = ?", [first.id]);
  check("an approved post is never redrawn", stillApproved.image_url === first.image_url);

  // Posts made before this shipped have no framing and no look key. They are
  // redrawn once, which is how the posts already waiting got the soft shadow.
  await sql.query("UPDATE scheduled_posts SET framing = NULL, look_key = NULL WHERE id = ?", [bandPost.id]);
  await autopost.redrawWaitingPosts();
  const [[migrated]] = await sql.query("SELECT framing, look_key FROM scheduled_posts WHERE id = ?", [bandPost.id]);
  check("a post from before framing existed is redrawn and given one",
    !!migrated.look_key && JSON.parse(migrated.framing ?? "{}").square?.fill === true, JSON.stringify(migrated));
  const [[againKey]] = await sql.query("SELECT look_key, image_url FROM scheduled_posts WHERE id = ?", [bandPost.id]);
  check("and redrawing again with nothing changed does nothing", (await autopost.redrawWaitingPosts()) === 0 && againKey.look_key === migrated.look_key);

  /* ---------- the photo editor (Brad: "adjust the saturation contrast and brightness and
     adjust the position and be able to crop and zoom") ---------- */
  await brad.mutate("autopost.save", { look: { corner: "bottom-right", size: "medium", retouch: "off", shadow: "soft" } });
  const forEditor = await brad.query("autopost.get");
  check("the editor is given the studio's touch-up as slider values",
    forEditor.data?.adjust?.brightness === 1 && forEditor.data?.adjust?.contrast === 1 && forEditor.data?.adjust?.saturation === 1,
    JSON.stringify(forEditor.data?.adjust));
  const lightPreset = (await import(`${ROOT}/dist/server/autopost.js`)).presetAdjust("light");
  check("and Light is the same numbers the server uses", lightPreset.brightness === 1.02 && lightPreset.saturation === 1.08 && lightPreset.contrast === 1.06, JSON.stringify(lightPreset));
  const bandRow = async () => (await sql.query("SELECT * FROM scheduled_posts WHERE id = ?", [bandPost.id]))[0][0];
  const squareOf = async () => (await brad.raw("GET", (await bandRow()).image_url)).bytes;
  const storyOf = async () => (await brad.raw("GET", (await bandRow()).story_url)).bytes;

  // Zoom 1 is the whole photo: both bands in the square, the blur either side.
  const whole = await brad.mutate("posts.reframe", { id: bandPost.id, square: { x: 0.5, y: 0.5, zoom: 1 } });
  let ed = await squareOf();
  check("zoom 1 shows the whole photo: the top band and the bottom band",
    whole.status === 200 && isGreen(await pixel(ed, 540, 60)) && isMagenta(await pixel(ed, 540, 1040)),
    JSON.stringify([await pixel(ed, 540, 60), await pixel(ed, 540, 1040)]));
  check("with the soft backdrop either side", lum3(await patch(ed, 10, 500, 60)) < lum3(await patch(ed, 500, 500, 60)) * 0.8);

  // Twice the size it takes to fill, from the top: the green band now runs
  // twice as far down the frame (540px instead of 270).
  await brad.mutate("posts.reframe", { id: bandPost.id, square: { x: 0.5, y: 0, zoom: 8 / 3 } });
  ed = await squareOf();
  check("zooming in crops closer", isGreen(await pixel(ed, 540, 400)) && !isGreen(await pixel(ed, 540, 700)),
    JSON.stringify([await pixel(ed, 540, 400), await pixel(ed, 540, 700)]));
  const zoomed = JSON.parse((await bandRow()).framing);
  check("and the zoom is remembered with the spot", Math.abs(zoomed.square?.zoom - 8 / 3) < 0.001 && zoomed.square?.set === true, JSON.stringify(zoomed));
  const greyBefore = await patch(ed, 150, 800, 60);
  // Brightened 40%, the green band reads (137, 255, 121): still plainly green,
  // just not by isGreen's thresholds, which were set for the untouched photo.
  const greenish = (p) => p.g > p.r + 80 && p.g > p.b + 80;

  // The post's own colour and logo.
  const styled = await brad.mutate("posts.reframe", {
    id: bandPost.id,
    style: { adjust: { brightness: 1.4, contrast: 1, saturation: 1 }, logo: { on: true, corner: "top-left", size: "medium", shadow: "off" } },
  });
  ed = await squareOf();
  check("brightness from the editor brightens the photo", styled.status === 200 && lum3(await patch(ed, 150, 800, 60)) > lum3(greyBefore) * 1.2,
    `${lum3(greyBefore).toFixed(0)} → ${lum3(await patch(ed, 150, 800, 60)).toFixed(0)}`);
  check("its own logo spot, top left, instead of the studio's bottom right",
    isRed(await pixel(ed, 49 + 100, 49 + 40)) && !isRed(await pixel(ed, SQ_LOGO.x, SQ_LOGO.y)));
  check("on the story too", isRed(await pixel(await storyOf(), 49 + 100, 230 + 40)));
  check("and the zoom wasn't lost by changing the colour", greenish(await pixel(ed, 540, 400)) && !greenish(await pixel(ed, 540, 700)));
  check("the post keeps its own style", JSON.parse((await bandRow()).photo_style ?? "{}").logo?.corner === "top-left");

  const keyBefore = (await bandRow()).look_key;
  await brad.mutate("autopost.save", { look: { size: "small" } });
  const afterStudioChange = await waitFor(async () => {
    const r = await bandRow();
    return r.look_key !== keyBefore ? r : null;
  }, 30000);
  const redrawnStyled = afterStudioChange ? (await brad.raw("GET", afterStudioChange.image_url)).bytes : undefined;
  check("a redraw for the studio's look keeps the post's own logo, colour and zoom",
    !!redrawnStyled && isRed(await pixel(redrawnStyled, 49 + 100, 49 + 40)) && greenish(await pixel(redrawnStyled, 540, 400)) &&
      lum3(await patch(redrawnStyled, 150, 800, 60)) > lum3(greyBefore) * 1.2);

  await brad.mutate("posts.reframe", { id: bandPost.id, style: { logo: { on: false, corner: "top-left", size: "medium", shadow: "off" } } });
  ed = await squareOf();
  check("the logo can be switched off for one photo", !isRed(await pixel(ed, 49 + 100, 49 + 40)) && !isRed(await pixel(ed, SQ_LOGO.x, SQ_LOGO.y)));
  const restored = await brad.mutate("posts.reframe", { id: bandPost.id, square: null, story: null, style: null });
  const restoredRow = await bandRow();
  check("Back to automatic drops the post's own style and spots", restored.status === 200 && restoredRow.photo_style === null &&
    JSON.parse(restoredRow.framing).square?.set === false);

  /* ---------- the editor on a post made by hand ---------- */
  const fromGallery = `/api/uploads/${bandPost.upload_id}`;
  const studioLogo = { on: true, corner: "bottom-right", size: "medium", shadow: "soft" };
  const plainColour = { brightness: 1, contrast: 1, saturation: 1 };
  const portrait = await brad.mutate("posts.editPhoto", {
    source: fromGallery, format: "portrait", spot: { x: 0.5, y: 0, zoom: 1.0667 }, style: { adjust: plainColour, logo: studioLogo },
  });
  const portraitPic = portrait.data?.url ? (await brad.raw("GET", portrait.data.url)).bytes : undefined;
  const portraitMeta = portraitPic ? await sharp(portraitPic).metadata() : {};
  check("a gallery photo can be edited for a post: a new picture", /^\/api\/attachments\/[0-9a-f]{40}$/.test(portrait.data?.url ?? ""), JSON.stringify(portrait));
  check("in the portrait shape, 1080 x 1350", portraitMeta.width === 1080 && portraitMeta.height === 1350, `${portraitMeta.width}x${portraitMeta.height}`);
  check("cropped where it was put, with the logo on",
    !!portraitPic && isGreen(await pixel(portraitPic, 540, 100)) && isRed(await pixel(portraitPic, SQ_LOGO.x, 1350 - 49 - 57)));
  const phone = await brad.raw("POST", "/api/post-image", { contentType: "image/jpeg", dataUrl: dataUrl(await banded) });
  const fromPhone = await brad.mutate("posts.editPhoto", {
    source: phone.json?.url, format: "square", spot: { x: 0.5, y: 1 }, style: { adjust: plainColour, logo: { ...studioLogo, on: false } },
  });
  const phonePic = fromPhone.data?.url ? (await brad.raw("GET", fromPhone.data.url)).bytes : undefined;
  check("so can a photo uploaded from the phone, logo off",
    !!phonePic && isMagenta(await pixel(phonePic, 200, 1040)) && !isRed(await pixel(phonePic, SQ_LOGO.x, SQ_LOGO.y)), JSON.stringify(fromPhone.error ?? ""));
  const editAgain = await brad.mutate("posts.editPhoto", { source: portrait.data?.url, format: "square", spot: { x: 0.5, y: 0.5 }, style: {} });
  check("an edit can itself be the starting point if it's ours", editAgain.status === 200);
  const link = await brad.mutate("posts.editPhoto", { source: "https://example.com/tattoo.jpg", format: "square", spot: { x: 0.5, y: 0.5 }, style: {} });
  check("a link to another site is refused in words, not fetched", link.status === 400 && /link to another site/.test(link.error ?? ""), JSON.stringify(link));
  check("a stranger can't use it", (await browser().mutate("posts.editPhoto", { source: fromGallery, format: "square", spot: { x: 0.5, y: 0.5 }, style: {} })).status === 401);
  const scheduled = await brad.mutate("posts.create", { content: "Fresh from Mim.", scheduledAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), imageUrl: portrait.data?.url });
  check("and the edited picture can go on a scheduled post", scheduled.status === 200, JSON.stringify(scheduled));
  const portraitOverlay = await brad.raw("GET", "/api/post-look/overlay?format=portrait&logo=on&corner=top-right&size=small&shadow=off");
  const poMeta = portraitOverlay.bytes ? await sharp(portraitOverlay.bytes).metadata() : {};
  check("the editor's logo guide follows its own choices", portraitOverlay.status === 200 && poMeta.width === 540 && poMeta.height === 675);

  // Asked at the very end, on purpose. The full run found it: the photo sent
  // while it was off waited in the queue behind a redraw, it was switched back
  // on in the meantime, and when its turn came it was made into a post — long
  // after "off means an upload is just an upload" had passed. By now every
  // redraw and every queued batch in this suite has run.
  const [lateRows] = await sql.query("SELECT id FROM scheduled_posts WHERE upload_id = ?", [sentWhileOff]);
  check("a photo sent while it was off never becomes a post later, even once it's back on",
    !!sentWhileOff && lateRows.length === 0, `${lateRows.length} post(s) for ${sentWhileOff}`);
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
