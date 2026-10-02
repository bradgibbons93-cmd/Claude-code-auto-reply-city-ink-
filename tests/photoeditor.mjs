// Brad, 2 October, on the photo in Schedule a post: "a little pop up tab or
// text either under or on the photo as a button ... edit or add logo and post
// then it will come up on that picture and can adjust the saturation contrast
// and brightness and adjust the position and be able to crop and zoom".
//
// The photo editor, on a phone, in a real browser against the built server,
// through both of its doors:
//   1. Schedule a post → a gallery photo → Edit & add logo → drag, zoom,
//      brightness, logo spot → Use this photo → the post carries the finished
//      picture, and Edit again starts from the original with the same settings.
//   2. A post waiting for its OK → Edit photo & logo → drag the square with a
//      mouse, the story with a real touch, pinch the story with two fingers,
//      switch the logo off → Save; then Back to automatic.
// Every result is checked in the JPEG the server drew, not just on screen.
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
const DB = ADMIN.replace(/\/[^/]*$/, "/runnit_editor");
const PORT = 5100 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = "editor-test-code";
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), "editor-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};

const mysql = (await import(`${ROOT}/node_modules/mysql2/promise.js`)).default;
const admin = await mysql.createConnection(ADMIN);
await admin.query("DROP DATABASE IF EXISTS runnit_editor");
await admin.query("CREATE DATABASE runnit_editor");
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
  // Tappable where it is now: nothing on top of its middle. No scrolling first
  // — the editor is a fixed sheet, and what matters is what a thumb can reach.
  const tappableHere = async (locator) => {
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
  const tappable = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    return tappableHere(locator);
  };
  const editor = page.locator('[data-testid="photo-editor"]');
  const frame = page.locator('[data-testid="editor-frame"]');
  const photoStyle = () => page.locator('[data-testid="editor-photo"]').evaluate((img) => ({
    width: img.style.width, height: img.style.height, left: img.style.left, top: img.style.top, filter: img.style.filter, src: img.getAttribute("src"),
  }));
  const ready = async () => {
    await editor.waitFor({ timeout: 10000 });
    await page.waitForFunction(() => {
      const img = document.querySelector('[data-testid="editor-photo"]');
      const logo = document.querySelector('[data-testid="editor-logo"]');
      return img?.complete && img.naturalWidth > 0 && img.style.width.endsWith("%") && logo?.complete && logo.naturalWidth > 0;
    }, null, { timeout: 15000 });
  };
  const setSlider = (name, value) =>
    page.locator(`#slider-${name}`).evaluate((el, v) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(el, String(v));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  const mouseDrag = async (dx, dy) => {
    const b = await frame.boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx + (dx * i) / 12, cy + (dy * i) / 12);
    await page.mouse.up();
  };
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const isWhite = (p) => p.r > 225 && p.g > 225 && p.b > 225;
  const greenish = (p) => p.g > p.r + 80 && p.g > p.b + 80;
  const LOGO_TL = { x: 49 + 100, y: 49 + 40 };
  const LOGO_BR = { x: 1080 - 49 - 227, y: 1080 - 49 - 62 };

  /* ====== 1. Schedule a post: the button on the photo ====== */
  await page.goto(`${BASE}/posts`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New post" }).first().tap();
  await page.getByRole("button", { name: "From studio gallery" }).tap();
  await page.getByRole("img", { name: "Studio photo" }).first().tap();
  const editButton = page.getByRole("button", { name: "Edit & add logo" });
  await editButton.waitFor({ timeout: 10000 });
  check("a photo on a post gets an Edit & add logo button right under it", (await editButton.count()) === 1);
  check("and a thumb can tap it", await tappable(editButton));
  check("it's a full finger's height", ((await editButton.boundingBox())?.height ?? 0) >= 44);
  await editButton.tap();
  await ready();
  const sheet = await editor.boundingBox();
  check("it opens as a pop-up over the whole screen", sheet?.x === 0 && sheet?.y === 0 && sheet?.width === 390 && sheet?.height === 844, JSON.stringify(sheet));
  const useIt = editor.getByRole("button", { name: "Use this photo" });
  check("with its save button on screen, above the app's menu", await tappableHere(useIt));
  check("Square and Portrait to pick from", (await editor.getByRole("tab").allInnerTexts()).join("|") === "Square|Portrait");
  check("the logo's on from the start", (await editor.getByRole("radiogroup", { name: "Logo", exact: true }).getByRole("radio", { name: "On" }).getAttribute("aria-checked")) === "true");
  check("working from the original photo", /^\/api\/uploads\/[0-9a-f]{40}$/.test((await photoStyle()).src ?? ""), (await photoStyle()).src);
  await page.screenshot({ path: `${SHOTS}/1-editor-open.png` });

  await mouseDrag(0, 300);
  check("dragging moves the photo, live", /^0(\.0+)?%$/.test((await photoStyle()).top), JSON.stringify(await photoStyle()));
  await setSlider("zoom", 8 / 3);
  // The slider moves in steps of 0.01, so 8/3 lands on 2.67: 200.25%, not 200.
  const twice = (w) => Math.abs(parseFloat(w) - 200) < 0.5;
  check("Zoom makes it bigger in the frame", twice((await photoStyle()).width), (await photoStyle()).width);
  await setSlider("brightness", 1.3);
  check("Brightness shows on the photo straight away", /brightness\(1\.3\)/.test((await photoStyle()).filter), (await photoStyle()).filter);
  await editor.getByRole("radiogroup", { name: "Logo spot" }).getByRole("radio", { name: "Top left" }).tap();
  await page.waitForFunction(() => document.querySelector('[data-testid="editor-logo"]')?.getAttribute("src")?.includes("corner=top-left"));
  check("moving the logo moves its guide", true);
  check("and the photo is still in view down at the logo options, not scrolled away", await tappableHere(frame));
  await page.screenshot({ path: `${SHOTS}/2-editor-edited.png` });
  await useIt.tap();
  await editor.waitFor({ state: "detached", timeout: 20000 });
  const finishedUrl = await page.locator('[data-testid="post-photo"] img').first().getAttribute("src");
  check("the post now carries the finished picture", /^\/api\/attachments\/[0-9a-f]{40}$/.test(finishedUrl ?? ""), finishedUrl);
  const finished = await image(finishedUrl);
  const finishedMeta = await sharp(finished).metadata();
  check("a 1080 square", finishedMeta.width === 1080 && finishedMeta.height === 1080);
  check("cropped in and moved the way it was dragged and zoomed",
    greenish(await pixel(finished, 540, 400)) && !greenish(await pixel(finished, 540, 700)),
    JSON.stringify([await pixel(finished, 540, 400), await pixel(finished, 540, 700)]));
  check("with the logo where it was put", isWhite(await pixel(finished, LOGO_TL.x, LOGO_TL.y)) && !isWhite(await pixel(finished, LOGO_BR.x, LOGO_BR.y)));
  const previewSrc = await page.locator("img[alt='']").evaluateAll((imgs, u) => imgs.some((i) => i.getAttribute("src") === u), finishedUrl);
  check("How it will look shows the finished picture", previewSrc);
  const again = page.getByRole("button", { name: "Edit again" });
  check("the button now says Edit again", (await again.count()) === 1);
  await again.tap();
  await ready();
  check("Edit again starts from the original, not the finished picture", /^\/api\/uploads\//.test((await photoStyle()).src ?? ""));
  check("with the settings it was left on", (await page.locator("#slider-brightness").inputValue()) === "1.3" && twice((await photoStyle()).width));
  await editor.getByRole("button", { name: "Close without saving" }).tap();
  await editor.waitFor({ state: "detached" });
  check("closing without saving leaves the picture alone", (await page.locator('[data-testid="post-photo"] img').first().getAttribute("src")) === finishedUrl);

  /* ====== 2. A post waiting for its OK ====== */
  await page.goto(`${BASE}/posts`, { waitUntil: "domcontentloaded" });
  const card = page.locator('[data-testid="review-post"]').first();
  await card.waitFor({ timeout: 20000 });
  const editPost = card.getByRole("button", { name: "Edit photo & logo" });
  check("a waiting post has Edit photo & logo", (await editPost.count()) === 1 && (await tappable(editPost)));
  await editPost.tap();
  await ready();
  check("Square and Story, the two pictures the post carries", (await editor.getByRole("tab").allInnerTexts()).join("|") === "Square|Story");
  await mouseDrag(0, 300);
  check("the square moves", /^0(\.0+)?%$/.test((await photoStyle()).top), JSON.stringify(await photoStyle()));

  await editor.getByRole("tab", { name: /Story/ }).tap();
  await page.waitForFunction(() => document.querySelector('[data-testid="editor-frame"]')?.style.aspectRatio.startsWith("1080 / 1920"));
  const sb = await frame.boundingBox();
  const sx = sb.x + sb.width / 2, sy = sb.y + sb.height / 2;
  const scrollArea = () => page.evaluate(() => document.querySelector('[data-testid="photo-editor"] .overflow-y-auto')?.scrollTop ?? -1);
  const scrollBefore = await scrollArea();
  await touch("touchStart", [{ x: sx, y: sy + 120, id: 1 }]);
  for (let i = 1; i <= 12; i++) await touch("touchMove", [{ x: sx, y: sy + 120 - i * 20, id: 1 }]);
  await touch("touchEnd", []);
  await sleep(150);
  check("a finger drags the story photo up", /^0(\.0+)?%$/.test((await photoStyle()).top), JSON.stringify(await photoStyle()));
  check("without scrolling the editor instead", (await scrollArea()) === scrollBefore);
  const widthBefore = parseFloat((await photoStyle()).width);
  await touch("touchStart", [{ x: sx - 40, y: sy, id: 1 }, { x: sx + 40, y: sy, id: 2 }]);
  for (let i = 1; i <= 10; i++) await touch("touchMove", [{ x: sx - 40 - i * 4, y: sy, id: 1 }, { x: sx + 40 + i * 4, y: sy, id: 2 }]);
  await touch("touchEnd", []);
  await sleep(150);
  const widthAfter = parseFloat((await photoStyle()).width);
  check("two fingers pinch it bigger", widthAfter > widthBefore * 1.8, `${widthBefore} → ${widthAfter}`);
  await editor.getByRole("radiogroup", { name: "Logo", exact: true }).getByRole("radio", { name: "Off" }).tap();
  await page.screenshot({ path: `${SHOTS}/3-waiting-post-editor.png` });
  await editor.getByRole("button", { name: "Save", exact: true }).tap();
  await editor.waitFor({ state: "detached", timeout: 20000 });
  const saved = await row();
  const framing = JSON.parse(saved.framing);
  check("saved: the square where it was dragged", framing.square?.set === true && framing.square?.y === 0, saved.framing);
  check("the story moved and zoomed by the pinch", framing.story?.set === true && framing.story?.zoom > 1.8, saved.framing);
  check("and the logo off for this post only", JSON.parse(saved.photo_style ?? "{}").logo?.on === false, saved.photo_style);
  const sq = await image(saved.image_url);
  check("the square the server drew: top of the photo, no logo",
    isGreen(await pixel(sq, 540, 100)) && !isWhite(await pixel(sq, LOGO_BR.x, LOGO_BR.y)), JSON.stringify(await pixel(sq, LOGO_BR.x, LOGO_BR.y)));
  const [[studioLook]] = await sql.query("SELECT value FROM app_settings WHERE name = 'auto_post'");
  check("the studio's own look wasn't touched", JSON.parse(studioLook.value).look?.corner === "bottom-right");

  await card.getByRole("button", { name: "Edit photo & logo" }).tap();
  await ready();
  check("it reopens with the logo still off", (await editor.getByRole("radiogroup", { name: "Logo", exact: true }).getByRole("radio", { name: "Off" }).getAttribute("aria-checked")) === "true");
  await editor.getByRole("button", { name: "Back to automatic" }).tap();
  await editor.waitFor({ state: "detached", timeout: 20000 });
  const auto = await row();
  check("Back to automatic: the app's own crop and the studio's look again",
    auto.photo_style === null && JSON.parse(auto.framing).square?.set === false && JSON.parse(auto.framing).story?.set === false, `${auto.framing} ${auto.photo_style}`);
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
console.log("All photo editor checks passed.");
process.exit(0);
