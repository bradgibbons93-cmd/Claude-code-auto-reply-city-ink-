// The whole first-time customer journey, in a real browser, on a phone.
//
// Brad, 29 September: "I want to be able to open the app as a brand-new
// customer and experience: Landing page → Sign Up → beautiful onboarding →
// personalise studio → dashboard → settings → logout → login → straight back
// into my personalised workspace." This walks exactly that, with real
// uploads, and then the edges he listed: a bad password, a refresh halfway
// through setup, an upload that isn't an image, a second studio.
//
// Starts its own server (open sign-up, fresh database) and makes its own test
// images, so `run-all.sh` can run it like any other suite. Point BASE at a
// running dashboard to skip that. Screenshots go to SHOTS (default /tmp/journey).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

process.env.TZ = "UTC";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SHOTS = process.env.SHOTS || "/tmp/journey";
fs.mkdirSync(SHOTS, { recursive: true });

let BASE = process.env.BASE;
let server;
if (!BASE) {
  const ADMIN = process.env.DATABASE_URL || "mysql://ci:ci@127.0.0.1:3306/cityink";
  const mysql = (await import(`${ROOT}/node_modules/mysql2/promise.js`)).default;
  const admin = await mysql.createConnection(ADMIN);
  await admin.query("DROP DATABASE IF EXISTS runnit_journey");
  await admin.query("CREATE DATABASE runnit_journey");
  await admin.end();
  const port = 4900 + Math.floor(Math.random() * 90);
  BASE = `http://localhost:${port}`;
  server = spawn("node", ["dist/server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      TZ: "UTC",
      NODE_ENV: "production",
      PORT: String(port),
      PUBLIC_SIGNUP: "open",
      DATABASE_URL: ADMIN.replace(/\/[^/]*$/, "/runnit_journey"),
      FACEBOOK_GRAPH_URL: "http://127.0.0.1:1",
      LLM_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 80 && !/Schema ready/.test(log); i++) await new Promise((r) => setTimeout(r, 250));
}

// Test images, made fresh: a transparent PNG logo, a wide banner, a portrait.
const FIXTURES = process.env.FIXTURES || fs.mkdtempSync(path.join(os.tmpdir(), "journey-"));
if (!process.env.FIXTURES) {
  const sharp = (await import("sharp")).default;
  const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
  await sharp(svg(600, 600, `<circle cx="300" cy="300" r="250" fill="none" stroke="#e25a46" stroke-width="26"/><path d="M300 120 L470 470 L130 470 Z" fill="none" stroke="#e25a46" stroke-width="26"/>`)).png().toFile(`${FIXTURES}/e2e_logo.png`);
  await sharp(svg(2400, 900, `<defs><radialGradient id="g"><stop offset="0" stop-color="#c88a5a"/><stop offset="1" stop-color="#1e1816"/></radialGradient></defs><rect width="2400" height="900" fill="url(#g)"/>`)).jpeg().toFile(`${FIXTURES}/e2e_cover.jpg`);
  await sharp(svg(900, 900, `<rect width="900" height="900" fill="#465a6e"/><circle cx="450" cy="350" r="170" fill="#deb896"/><circle cx="450" cy="900" r="300" fill="#282832"/>`)).jpeg().toFile(`${FIXTURES}/e2e_avatar.jpg`);
}

const { chromium } = await import(`${ROOT}/node_modules/playwright/index.mjs`);
const executablePath = fs.existsSync("/opt/pw-browsers/chromium-1194/chrome-linux/chrome")
  ? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
  : undefined;
const browser = await chromium.launch({ executablePath });

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};

const stamp = Date.now().toString(36);
const email = `owner-${stamp}@example.com`;
const password = "a very good password";
const errors = [];

async function newPhone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/fonts\.g|Failed to load resource.*(401|403)/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const fixture = (name) => `${FIXTURES}/${name}`;

try {
  const { ctx, page } = await newPhone();

  /* ---------- landing ---------- */
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForTimeout(900);
  check("a visitor lands on the landing page", await page.getByRole("heading", { level: 1 }).first().isVisible());
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("with no sideways scrolling on a phone", overflow <= 1, `${overflow}px`);
  await shot(page, "01-landing");

  /* ---------- sign up ---------- */
  await page.getByRole("link", { name: /create your studio/i }).first().click();
  await page.waitForURL(/\/signup/);
  await page.getByLabel("Your name").fill("Brad Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await shot(page, "02-signup");
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/welcome/, { timeout: 15000 });
  await page.waitForTimeout(700);
  check("sign up goes straight into setup", page.url().endsWith("/welcome"));
  await shot(page, "03-welcome");

  /* ---------- step 1: you ---------- */
  await page.getByRole("button", { name: /let's go/i }).click();
  await page.waitForTimeout(500);
  await page.locator('input[type="file"]').first().setInputFiles(fixture("e2e_avatar.jpg"));
  await page.waitForSelector('button[aria-label^="Replace profile photo"] img', { timeout: 15000 });
  check("a profile photo uploads and shows", true);
  await shot(page, "04-you");
  await page.getByRole("button", { name: /^continue/i }).click();
  await page.waitForTimeout(600);

  /* ---------- step 2: studio, with a refresh in the middle ---------- */
  await page.getByLabel("Studio name").fill("Northside Ink");
  await page.getByLabel("Suburb or city").fill("Geelong, VIC");
  await page.getByLabel("Instagram").fill("@northsideink");
  await shot(page, "05-studio");
  await page.getByRole("button", { name: /^continue/i }).click();
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  check("a refresh mid-setup resumes on the same step", await page.getByText("Make it look like yours.").isVisible());

  /* ---------- step 3: branding, including a bad file ---------- */
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.waitForTimeout(600);
  check("a file that isn't an image is refused with a reason", await page.getByText(/Use a JPG, PNG, WebP or GIF/).first().isVisible());
  await inputs.nth(0).setInputFiles(fixture("e2e_logo.png"));
  await page.waitForSelector('button[aria-label^="Replace studio logo"] img', { timeout: 15000 });
  await inputs.nth(2).setInputFiles(fixture("e2e_cover.jpg"));
  await page.waitForSelector('button[aria-label^="Replace banner"] img', { timeout: 15000 });
  check("logo and banner upload", true);
  await shot(page, "06-brand");
  await page.getByRole("button", { name: /^continue/i }).click();
  await page.waitForTimeout(800);

  /* ---------- step 4: look ---------- */
  await page.getByRole("button", { name: "Bold Red theme" }).click();
  await page.waitForTimeout(400);
  await shot(page, "07-look");
  await page.getByRole("button", { name: /use this look/i }).click();
  await page.waitForTimeout(900);

  /* ---------- step 5 + 6 ---------- */
  check("a preview of their workspace", await page.getByText("Here's your workspace.").isVisible());
  await shot(page, "08-preview");
  await page.getByRole("button", { name: /looks good/i }).click();
  await page.waitForTimeout(900);
  check("and a finish line", await page.getByText("Your workspace is ready.").isVisible());
  await shot(page, "09-done");
  await page.getByRole("button", { name: /enter your dashboard/i }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 15000 });
  await page.waitForTimeout(1500);

  /* ---------- the dashboard is theirs ---------- */
  const body = await page.locator("main").innerText();
  check("the dashboard greets them by name", /Brad/.test(body), body.slice(0, 120));
  check("and names their studio", /Northside Ink/i.test(await page.locator("body").innerText()));
  const display = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-display"));
  check("in the theme they chose", /Syne/.test(display), display);
  const logoShown = await page.locator('img[src^="/api/brand/"]').count();
  check("with their logo and photo on screen", logoShown >= 2, String(logoShown));
  await shot(page, "10-dashboard");

  /* ---------- refresh, then log out and back in ---------- */
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  check("a refresh keeps them in their workspace", new URL(page.url()).pathname === "/" && !(await page.getByText("Let's get your studio set up.").count()));
  await page.locator('button[aria-haspopup="menu"]').last().click();
  await page.getByRole("menuitem", { name: /log out/i }).click();
  await page.waitForURL(/\/login/, { timeout: 10000 });
  check("log out lands on log in", true);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel(/^Password/).fill("the wrong one");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForTimeout(900);
  check("a bad password says so", await page.getByText("That email and password don't match.").isVisible());
  await shot(page, "11-bad-login");
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
  await page.waitForTimeout(1200);
  check("logging back in skips setup", !(await page.getByText("Let's get your studio set up.").count()) && /Brad/.test(await page.locator("main").innerText()));

  /* ---------- settings persist ---------- */
  await page.goto(`${BASE}/settings?tab=studio`, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.getByLabel("Tagline").fill("Fine line & blackwork");
  await page.getByRole("button", { name: /save changes/i }).last().click();
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1200);
  check("a studio setting survives a refresh", (await page.getByLabel("Tagline").inputValue()) === "Fine line & blackwork");
  await shot(page, "12-settings");

  /* ---------- a second studio ---------- */
  await page.goto(`${BASE}/studios/new`, { waitUntil: "load" });
  await page.waitForTimeout(900);
  await page.getByPlaceholder("City Ink Melbourne").fill("Northside Ink Fitzroy");
  await page.getByPlaceholder("Melbourne, VIC").fill("Fitzroy, VIC");
  await page.getByRole("button", { name: /create studio/i }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Sage Studio theme" }).click();
  await page.getByRole("button", { name: /open northside ink fitzroy/i }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
  await page.waitForTimeout(1300);
  const second = await page.locator("body").innerText();
  check("a second studio opens as its own workspace", /Northside Ink Fitzroy/.test(second) && /Fitzroy, VIC/i.test(second));
  const secondFont = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-display"));
  check("in its own look", /Fraunces/.test(secondFont), secondFont);
  check("and says plainly it has no inbox yet", /inbox isn't connected yet/i.test(second));
  await shot(page, "13-second-studio");

  await page.getByRole("button", { name: /open menu/i }).click();
  await page.waitForTimeout(400);
  await page.locator('aside:visible button[aria-haspopup="menu"]').first().click();
  await page.getByRole("menuitemradio", { name: /^Northside Ink Geelong|^Northside Ink\s/ }).first().click();
  await page.waitForTimeout(1500);
  const back = await page.locator("body").innerText();
  check("switching back brings back the first studio", /Northside Ink/.test(back) && !/inbox isn't connected yet/i.test(back));
  const backFont = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-display"));
  check("with its own look back too", /Syne/.test(backFont), backFont);
  await ctx.close();

  /* ---------- another device, days later ---------- */
  const { ctx: laptopCtx, page: laptop } = await (async () => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    return { ctx: c, page: p };
  })();
  await laptop.goto(`${BASE}/dashboard-that-does-not-exist`, { waitUntil: "load" });
  await laptop.waitForTimeout(800);
  check("a signed-out deep link goes to log in", /\/login\?next=/.test(laptop.url()), laptop.url());
  await laptop.getByLabel("Email").fill(email);
  await laptop.getByLabel(/^Password/).fill(password);
  await laptop.getByRole("button", { name: /^log in$/i }).click();
  await laptop.waitForTimeout(1800);
  check("the laptop opens on the studio last used, in its look", /Northside Ink/.test(await laptop.locator("body").innerText()));
  await laptop.goto(`${BASE}/`, { waitUntil: "load" });
  await laptop.waitForTimeout(1500);
  await laptop.screenshot({ path: `${SHOTS}/14-desktop-dashboard.png` });
  await laptop.goto(`${BASE}/settings?tab=appearance`, { waitUntil: "load" });
  await laptop.waitForTimeout(1500);
  await laptop.screenshot({ path: `${SHOTS}/15-desktop-appearance.png`, fullPage: true });
  await laptopCtx.close();

  /* ---------- tablet ---------- */
  const tabletCtx = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  const tablet = await tabletCtx.newPage();
  await tablet.goto(`${BASE}/signup`, { waitUntil: "load" });
  await tablet.waitForTimeout(800);
  const tabletOverflow = await tablet.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("sign up fits a tablet", tabletOverflow <= 1, `${tabletOverflow}px`);
  await tablet.screenshot({ path: `${SHOTS}/16-tablet-signup.png` });
  await tabletCtx.close();
} catch (error) {
  failures++;
  console.log(`FAIL  the journey broke — ${error.message}`);
} finally {
  await browser.close();
  server?.kill();
}

const real = errors.filter((e) => !/favicon|manifest/.test(e));
check("no errors in the browser console", real.length === 0, real.slice(0, 5).join(" | "));
console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
