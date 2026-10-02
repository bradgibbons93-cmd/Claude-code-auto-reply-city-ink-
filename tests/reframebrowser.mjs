// Brad, 2 October: "the shadow on the logo is way to dark, also I want to be
// able to drag to recenter the picture".
//
// The drag, on a phone, in a real browser against the built server: Posts →
// a post waiting for its OK → Move photo → drag the square with a finger-like
// pointer and the story with a real touch → Save position — and then the
// JPEGs the server drew are read back to prove the photo actually moved, in
// the direction it was dragged. Plus: dragging must not scroll the page
// (touch-action), the logo is laid over the drag, Back to automatic, Cancel,
// and the shadow choice in the Gallery card.
//
// Runs the built server on its own database, on UTC. Screenshots go to SHOTS
// (default: a temp folder) for a person to look at.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TZ = "UTC";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const require = createRequire(`${ROOT}/package.json`);
const sharp = require("sharp");
const ADMIN = process.env.DATABASE_URL || "mysql://ci:ci@127.0.0.1:3306/cityink";
const DB = ADMIN.replace(/\/[^/]*$/, "/runnit_reframe");
const PORT = 5100 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = "reframe-test-code";
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "reframe-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};

const mysql = (await import(`${ROOT}/node_modules/mysql2/promise.js`)).default;
const admin = await mysql.createConnection(ADMIN);
await admin.query("DROP DATABASE IF EXISTS runnit_reframe");
await admin.query("CREATE DATABASE runnit_reframe");
await admin.end();

async function boot() {
  const server = spawn("node", ["dist/server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TZ: "UTC",
      PORT: String(PORT),
      DATABASE_URL: DB,
      FACEBOOK_GRAPH_URL: "http://127.0.0.1:1",
      // No model: captions fall back to the stock lines, which is all this needs.
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
  for (let i = 0; i < 80 && !/Schema ready/.test(log); i++) await sleep(250);
  return { server, log: () => log };
}

let run = await boot();
run.server.kill();
await sleep(500);
const sql = await mysql.createConnection(DB);
await sql.query(
  `INSERT INTO facebook_config (page_id, page_name, page_access_token, app_id, app_secret, webhook_verify_token, is_configured)
   VALUES ('P1', 'City Ink Tattoo Geelong', 'tok', 'app', 'secret', 'verify', 1)`
);
run = await boot();

/* ---------- pictures ---------- */
// A phone's 3:4 photo with a green band across the top and a magenta one
// across the bottom, so which part of it is in the frame can be read back.
async function banded() {
  const w = 1200, h = 1600;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const [r, g, b] = y < 300 ? [30, 200, 40] : y >= h - 300 ? [210, 30, 200] : [150, 140, 130];
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}
// A white logo on transparency, like Brad's "City Ink official logo white".
const logo = await sharp({ create: { width: 400, height: 110, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp({ create: { width: 380, height: 90, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(), left: 10, top: 10 }])
  .png()
  .toBuffer();
const dataUrl = (bytes, type) => `data:${type};base64,${bytes.toString("base64")}`;
async function pixel(bytes, x, y) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}
const isGreen = (p) => p.g > 150 && p.r < 110 && p.b < 110;
const isMagenta = (p) => p.r > 150 && p.b > 140 && p.g < 110;

const { chromium } = await import(`${ROOT}/node_modules/playwright/index.mjs`);
const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const browser = await chromium.launch({ executablePath });

try {
  /* ---------- Brad, set up, with the white logo for posts ---------- */
  const signup = await fetch(`${BASE}/api/trpc/account.signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Brad Test", email: "brad@example.test", password: "password123", code: CODE }),
  });
  const token = (signup.headers.getSetCookie?.() ?? [])
    .find((l) => l.startsWith("runnit_session="))
    ?.split(";")[0]
    .split("=")[1];
  check("the owner signs up with the code", signup.status === 200 && !!token, String(signup.status));
  await sql.query("UPDATE users SET onboarding_completed_at = NOW(), onboarding_step = 'done'");
  const auth = { cookie: `runnit_session=${token}`, "content-type": "application/json" };
  const up = await (await fetch(`${BASE}/api/brand`, { method: "POST", headers: auth, body: JSON.stringify({ kind: "postlogo", dataUrl: dataUrl(logo, "image/png") }) })).json();
  await fetch(`${BASE}/api/trpc/autopost.save`, { method: "POST", headers: auth, body: JSON.stringify({ logoAssetId: up.id }) });

  /* ---------- Mim sends a photo; it waits for the OK ---------- */
  await fetch(`${BASE}/api/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ artistName: "Mim", photos: [{ contentType: "image/jpeg", dataUrl: dataUrl(await banded(), "image/jpeg") }] }),
  });
  let post;
  for (let i = 0; i < 60 && !post; i++) {
    [[post]] = await sql.query("SELECT * FROM scheduled_posts WHERE status = 'review'");
    if (!post) await sleep(300);
  }
  check("the photo became a post waiting for the OK", !!post?.upload_id);
  const row = async () => (await sql.query("SELECT * FROM scheduled_posts WHERE id = ?", [post.id]))[0][0];
  const image = async (url) => Buffer.from(await (await fetch(`${BASE}${url}`, { headers: auth })).arrayBuffer());

  /* ---------- on a phone ---------- */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addCookies([{ name: "runnit_session", value: token, url: BASE }]);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const tappable = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) return false;
    return page.evaluate(
      ([x, y, el]) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === el || el.contains(hit));
      },
      [box.x + box.width / 2, box.y + box.height / 2, await locator.elementHandle()]
    );
  };

  await page.goto(`${BASE}/posts`, { waitUntil: "domcontentloaded" });
  const card = page.locator('[data-testid="review-post"]').first();
  await card.waitFor({ timeout: 20000 });
  const moveButton = card.getByRole("button", { name: "Move photo" });
  check("each waiting post has a Move photo button", (await moveButton.count()) === 1);
  check("and it can actually be tapped (nothing on top of it)", await tappable(moveButton));
  const moveBox = await moveButton.boundingBox();
  check("and it's a full finger's height", (moveBox?.height ?? 0) >= 44, String(moveBox?.height));
  await moveButton.tap();

  const editor = page.locator('[data-testid="reframe-editor"]');
  await editor.waitFor({ timeout: 10000 });
  const frame = page.locator('[data-testid="reframe-box"]');
  await page.waitForFunction(() => {
    const img = document.querySelector('[data-testid="reframe-photo"]');
    return img && img.complete && img.naturalWidth > 0;
  }, null, { timeout: 15000 });
  await page
    .waitForFunction(() =>
      [...document.querySelectorAll('[data-testid="reframe-box"] img')].some((i) => i.src.includes("/api/post-look/overlay") && i.complete && i.naturalWidth > 0),
      null, { timeout: 10000 })
    .catch(() => undefined);
  await sleep(700); // the frame scrolls itself into view
  const hint = page.locator('[data-testid="reframe-hint"]');
  check("a phone photo in the square can go up or down, and it says so", /Drag up or down/.test(await hint.innerText()), await hint.innerText());
  const overlayLoaded = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="reframe-box"] img')].some((i) => i.src.includes("/api/post-look/overlay") && i.naturalWidth > 0)
  );
  check("the logo is laid over the photo while it's moved", overlayLoaded);
  const frameBox = await frame.boundingBox();
  check("the frame takes the card's width on a phone", (frameBox?.width ?? 0) >= 270, JSON.stringify(frameBox));
  await page.screenshot({ path: `${SHOTS}/editor-square-before.png` });

  // A drag DOWN by most of the frame: the photo follows the finger, so the
  // top of the photo — the green band — comes into view.
  const cx = frameBox.x + frameBox.width / 2;
  const cy = frameBox.y + frameBox.height / 2;
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.move(cx, cy - 120);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(cx, cy - 120 + i * 25);
  await page.mouse.up();
  const position = await page.locator('[data-testid="reframe-photo"]').evaluate((img) => img.style.objectPosition);
  check("dragging down shows the top of the photo, live", /^50(\.00)?% 0(\.00)?%$/.test(position), position);
  check("and dragging didn't scroll the page", (await page.evaluate(() => window.scrollY)) === scrollBefore);
  check("the square tab says it's been moved", /moved/.test(await page.getByRole("tab", { name: /Square post/ }).innerText()));
  await page.screenshot({ path: `${SHOTS}/editor-square-dragged.png` });

  // The story, with a real touch: a 3:4 photo is shown whole in a story, so
  // it slides up and down over the blur. Drag it UP with a finger.
  await page.getByRole("tab", { name: /Story/ }).tap();
  await page.waitForFunction(() => document.querySelector('[data-testid="reframe-box"]')?.className.includes("aspect-[9/16]"));
  await sleep(800); // it scrolls itself clear of the bottom menu
  const storyBox = await frame.boundingBox();
  const clear = await page.evaluate(([x, top, bottom]) => {
    const box = document.querySelector('[data-testid="reframe-box"]');
    const at = (y) => { const hit = document.elementFromPoint(x, y); return !!hit && box.contains(hit); };
    return at(top + 8) && at(bottom - 8);
  }, [storyBox.x + storyBox.width / 2, storyBox.y, storyBox.y + storyBox.height]);
  check("the tall story frame comes fully into view, clear of the header and the bottom menu", clear, JSON.stringify(storyBox));
  const sx = storyBox.x + storyBox.width / 2;
  const sy = storyBox.y + storyBox.height / 2;
  const touchScroll = await page.evaluate(() => window.scrollY);
  const touch = (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await touch("touchStart", sx, sy + 150);
  for (let i = 1; i <= 12; i++) await touch("touchMove", sx, sy + 150 - i * 25);
  await touch("touchEnd", sx, sy - 150);
  await sleep(200);
  const storyPosition = await page.locator('[data-testid="reframe-photo"]').evaluate((img) => img.style.objectPosition);
  check("a finger drag moves the story photo up", /^50(\.00)?% 0(\.00)?%$/.test(storyPosition), storyPosition);
  check("and the finger didn't scroll the page instead", (await page.evaluate(() => window.scrollY)) === touchScroll);
  await page.screenshot({ path: `${SHOTS}/editor-story-dragged.png` });

  const save = editor.getByRole("button", { name: "Save position" });
  // Without scrolling: the editor brought itself into view, Save included.
  const saveBox = await save.boundingBox();
  const saveHit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.textContent ?? "", [saveBox.x + saveBox.width / 2, saveBox.y + saveBox.height / 2]);
  check("Save position is on screen and tappable without scrolling, not under the menu", /Save position/.test(saveHit), saveHit);
  await save.tap();
  await editor.waitFor({ state: "detached", timeout: 20000 });
  const saved = await row();
  const framing = JSON.parse(saved.framing);
  check("saving records both spots as placed by hand",
    framing.square?.set === true && framing.square?.y === 0 && framing.story?.set === true && framing.story?.y === 0, saved.framing);
  const square = await image(saved.image_url);
  check("the square post the server drew shows the top of the photo",
    isGreen(await pixel(square, 540, 100)) && !isMagenta(await pixel(square, 200, 1040)), JSON.stringify(await pixel(square, 540, 100)));
  const story = await image(saved.story_url);
  check("and the story has the photo up against the top",
    isGreen(await pixel(story, 540, 60)) && !isMagenta(await pixel(story, 540, 1860)), JSON.stringify(await pixel(story, 540, 60)));
  const shown = await card.locator("img").first().getAttribute("src");
  check("the card shows the new picture straight away", shown === saved.image_url, `${shown} vs ${saved.image_url}`);
  await card.screenshot({ path: `${SHOTS}/card-after.png` });

  /* ---------- Cancel changes nothing; Back to automatic undoes ---------- */
  await card.getByRole("button", { name: "Move photo" }).tap();
  await editor.waitFor();
  const back = editor.getByRole("button", { name: "Back to automatic" });
  check("a hand-placed photo offers Back to automatic", (await back.count()) === 1);
  await editor.getByRole("button", { name: "Cancel" }).tap();
  await editor.waitFor({ state: "detached" });
  check("Cancel leaves it where it was", (await row()).image_url === saved.image_url);

  await card.getByRole("button", { name: "Move photo" }).tap();
  await editor.waitFor();
  await editor.getByRole("button", { name: "Back to automatic" }).tap();
  await editor.waitFor({ state: "detached", timeout: 20000 });
  const auto = JSON.parse((await row()).framing);
  check("Back to automatic hands the square back to sharp, story untouched", auto.square?.set === false && auto.story?.set === true, JSON.stringify(auto));

  /* ---------- the shadow choice in the Gallery ---------- */
  await page.goto(`${BASE}/gallery`, { waitUntil: "domcontentloaded" });
  const gallery = page.locator('[data-testid="autopost-card"]');
  await gallery.waitFor({ timeout: 15000 });
  const soft = gallery.getByRole("radiogroup", { name: "Logo shadow" }).getByRole("radio", { name: "Soft" });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="autopost-card"] [role="radiogroup"][aria-label="Logo shadow"] [aria-checked="true"]'),
    null, { timeout: 10000 }).catch(() => undefined);
  check("the Gallery card has a logo shadow choice, Soft by default", (await soft.getAttribute("aria-checked")) === "true");
  const none = gallery.getByRole("radiogroup", { name: "Logo shadow" }).getByRole("radio", { name: "None" });
  check("None can be tapped", await tappable(none));
  await none.tap();
  await sleep(800);
  const [[settings]] = await sql.query("SELECT value FROM app_settings WHERE name = 'auto_post'");
  check("and it saves", JSON.parse(settings.value).look?.shadow === "off", settings.value);
  const previewSrc = await gallery.locator("img[alt^='The square post']").getAttribute("src");
  check("the preview redraws with no shadow", /shadow=off/.test(previewSrc ?? ""), previewSrc);
  await gallery.screenshot({ path: `${SHOTS}/gallery-card.png` });

  // The post waiting is redrawn in the new look by itself, a few seconds on.
  const before = (await row()).look_key;
  let redrawn;
  for (let i = 0; i < 60 && !redrawn; i++) {
    const r = await row();
    if (r.look_key !== before) redrawn = r;
    else await sleep(500);
  }
  check("changing the shadow redraws the post that's waiting", !!redrawn);
  check("keeping the story where it was dragged", JSON.parse(redrawn?.framing ?? "{}").story?.y === 0);
} catch (error) {
  failures++;
  console.error("FAIL  the suite threw:", error);
} finally {
  await browser.close();
  run.server.kill();
  await sql.end();
}

console.log(`\nScreenshots: ${SHOTS}`);
if (failures) {
  console.log(`\n${failures} failure(s). Server log tail:\n${run.log().split("\n").slice(-30).join("\n")}`);
  process.exit(1);
}
console.log("All reframe checks passed.");
process.exit(0);
