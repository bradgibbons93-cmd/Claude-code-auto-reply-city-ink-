// Accounts, studios and who may read what — against the real server.
//
// Brad, 29 September: a landing page, sign up, onboarding, several studios
// per login, and "returning users should get straight back into their
// workspace". The part that must never be wrong is underneath all of that:
// once anyone can sign up, the only thing standing between a stranger and
// City Ink's customers — their names, their messages, their photos — is the
// rule in trpc.ts and auth.ts. So most of this suite is a stranger trying.
//
// Runs the built server (npm run build first) against a real database, on
// UTC like Railway.
import { spawn } from "node:child_process";
import crypto from "node:crypto";

process.env.TZ = "UTC";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DATABASE_URL = process.env.DATABASE_URL || "mysql://ci:ci@127.0.0.1:3306/cityink";
const PORT = 4460 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const CLAIM = "old-dashboard-password";

const mysql = (await import(`${ROOT}/node_modules/mysql2/promise.js`)).default;
const sql = await mysql.createConnection(DATABASE_URL);

// A studio that already has an inbox — City Ink before accounts existed.
for (const table of [
  "sessions", "studio_members", "studios", "brand_assets", "users", "app_settings",
  "pending_replies", "messenger_messages", "messenger_conversations", "message_attachments", "facebook_config",
]) {
  await sql.query(`DELETE FROM ${table}`).catch(() => {});
}
await sql.query(
  `INSERT INTO facebook_config (page_id, page_name, page_access_token, app_id, app_secret, webhook_verify_token, is_configured)
   VALUES ('P1', 'City Ink Tattoo', 'tok', 'app', 'secret', 'verify', 1)`
);
await sql.query(
  "INSERT INTO messenger_conversations (conversation_id, sender_name, platform, last_message_at) VALUES ('cust1', 'Secret Customer', 'instagram', NOW())"
);
await sql.query(
  "INSERT INTO messenger_messages (conversation_id, message_id, sender_type, content, created_at) VALUES ('cust1', 'm1', 'customer', 'my private message', NOW())"
);
await sql.query(
  "INSERT INTO message_attachments (id, conversation_id, message_id, content_type, bytes) VALUES ('custphoto', 'cust1', 'm1', 'image/jpeg', ?)",
  [Buffer.from("not really a jpeg")]
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
    LLM_API_KEY: "",
    NODE_ENV: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`${BASE}/health`)).ok && /Schema ready/.test(serverLog)) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 250));
}

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};

/** A browser: remembers its cookie. */
function browser() {
  let cookie = "";
  const remember = (res) => {
    const set = res.headers.getSetCookie?.() ?? [];
    for (const line of set) {
      const [pair] = line.split(";");
      const [name, value] = pair.split("=");
      if (name === "runnit_session") cookie = value ? `runnit_session=${value}` : "";
    }
  };
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    remember(res);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  };
  return {
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
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

try {
  /* ---------- nobody signed in ---------- */
  const anon = browser();
  const me0 = await anon.query("account.me");
  check("a visitor is nobody", me0.status === 200 && me0.data?.user === null, JSON.stringify(me0));
  check("and can't read the inbox", (await anon.query("conversations.list")).status === 401);
  check("or a customer's photo", (await anon.raw("GET", "/api/attachments/custphoto")).status === 401);

  const [studioRows] = await sql.query("SELECT id, name FROM studios");
  check("the existing inbox became a studio of its own on boot",
    studioRows.length === 1 && studioRows[0].name === "City Ink Tattoo", JSON.stringify(studioRows));
  const cityInkId = studioRows[0]?.id;

  /* ---------- Brad signs up and links City Ink ---------- */
  const brad = browser();
  const signup = await brad.mutate("account.signup", { name: "Brad", email: " Brad@Example.com ", password: "correct horse" });
  check("sign up works and signs you in", signup.status === 200 && !!brad.cookie, JSON.stringify(signup));
  check("new accounts start at the beginning of setup", signup.data?.user?.onboardingStep === "welcome");
  check("the email is stored tidy", signup.data?.user?.email === "brad@example.com");
  check("the unclaimed studio is offered", signup.data?.claimable?.name === "City Ink Tattoo", JSON.stringify(signup.data?.claimable));
  check("but its inbox isn't readable before it's claimed", (await brad.query("conversations.list")).status === 403);

  const dup = await browser().mutate("account.signup", { name: "Someone", email: "brad@example.com", password: "whatever123" });
  check("one account per email", dup.status === 409 && /already an account/.test(dup.error ?? ""), JSON.stringify(dup));
  const weak = await browser().mutate("account.signup", { name: "X", email: "x@example.com", password: "short" });
  check("short passwords are refused", weak.status === 400, JSON.stringify(weak));

  const wrongClaim = await brad.mutate("studios.claim", { code: "guess" });
  check("a wrong claim code is refused", wrongClaim.status === 401, JSON.stringify(wrongClaim));
  const claim = await brad.mutate("studios.claim", { code: CLAIM });
  check("the right code links the studio", claim.status === 200 && claim.data?.id === cityInkId, JSON.stringify(claim));
  const list = await brad.query("conversations.list");
  check("and then the inbox is his", list.status === 200 && list.data?.some((c) => c.senderName === "Secret Customer"), JSON.stringify(list).slice(0, 200));
  check("photos too", (await brad.raw("GET", "/api/attachments/custphoto")).status === 200);
  const again = await browser().mutate("account.signup", { name: "Late", email: "late@example.com", password: "latecomer1" });
  check("once claimed, nobody else is offered it", again.data?.claimable === null, JSON.stringify(again.data?.claimable));

  /* ---------- onboarding persists ---------- */
  await brad.mutate("onboarding.setStep", { step: "look" });
  check("setup remembers where you got to", (await brad.query("account.me")).data?.user?.onboardingStep === "look");
  await brad.mutate("onboarding.complete");
  const done = (await brad.query("account.me")).data?.user;
  check("and that it's finished", done?.onboardingComplete === true && done?.onboardingStep === "done", JSON.stringify(done));
  await brad.mutate("onboarding.setStep", { step: "welcome" });
  check("finished stays finished", (await brad.query("account.me")).data?.user?.onboardingComplete === true);

  /* ---------- a stranger ---------- */
  const stranger = browser();
  await stranger.mutate("account.signup", { name: "Stranger", email: "stranger@example.com", password: "stranger-pass" });
  const made = await stranger.mutate("studios.create", { name: "Other Ink", location: "Perth" });
  check("a stranger can make their own studio", made.status === 200 && made.data?.id > 0, JSON.stringify(made));
  const strangerMe = (await stranger.query("account.me")).data;
  check("which is theirs and not connected", strangerMe?.studios?.length === 1 && strangerMe.studios[0].connected === false);
  for (const proc of ["conversations.list", "pendingReplies.list", "stats", "dashboard", "config.facebook", "knowledge.list"]) {
    const r = await stranger.query(proc);
    check(`a stranger can't read ${proc}`, r.status === 403, `${r.status} ${JSON.stringify(r.data)?.slice(0, 80)}`);
  }
  check("or City Ink's customer photos", (await stranger.raw("GET", "/api/attachments/custphoto")).status === 401);
  check("or switch into City Ink", (await stranger.mutate("studios.switch", { id: cityInkId })).status === 403);
  check("or rename it", (await stranger.mutate("studios.update", { id: cityInkId, name: "Pwned" })).status === 403);
  check("or restyle it", (await stranger.mutate("studios.setAppearance", { id: cityInkId, theme: "blush" })).status === 403);
  const [[ci]] = await sql.query("SELECT name, theme FROM studios WHERE id = ?", [cityInkId]);
  check("City Ink is untouched", ci.name === "City Ink Tattoo" && ci.theme !== "blush", JSON.stringify(ci));

  /* ---------- logging in ---------- */
  const wrong = await browser().mutate("account.login", { email: "brad@example.com", password: "nope nope" });
  check("a wrong password says so, without saying which half", wrong.status === 401 && /don't match/.test(wrong.error ?? ""), JSON.stringify(wrong));
  const ghost = await browser().mutate("account.login", { email: "nobody@example.com", password: "nope nope" });
  check("an unknown email gets the same words", ghost.error === wrong.error);
  const laptop = browser();
  const login = await laptop.mutate("account.login", { email: "BRAD@example.com", password: "correct horse" });
  check("the right password signs in on another device", login.status === 200 && login.data?.user?.onboardingComplete === true, JSON.stringify(login).slice(0, 200));
  check("straight back into the connected studio", login.data?.currentStudioId === cityInkId);

  const guesser = browser();
  let last;
  for (let i = 0; i < 12; i++) last = await guesser.mutate("account.login", { email: "stranger@example.com", password: `guess${i}` });
  check("guessing is slowed down", last.status === 429, JSON.stringify(last));

  /* ---------- several studios ---------- */
  const second = await brad.mutate("studios.create", { name: "City Ink Melbourne", location: "Melbourne" });
  const bradMe = (await brad.query("account.me")).data;
  check("a second studio", bradMe?.studios?.length === 2 && bradMe.currentStudioId === second.data?.id, JSON.stringify(bradMe?.studios?.map((s) => s.name)));
  check("opens on the new one", bradMe?.studios?.find((s) => s.id === bradMe.currentStudioId)?.name === "City Ink Melbourne");
  check("which has no inbox of its own yet", (await brad.query("conversations.list")).status === 403);
  await brad.mutate("studios.setAppearance", { id: second.data.id, theme: "sage", accent: "#3a7d5c" });
  await brad.mutate("studios.switch", { id: cityInkId });
  const back = (await brad.query("account.me")).data;
  check("switching back", back.currentStudioId === cityInkId && (await brad.query("conversations.list")).status === 200);
  check("each studio keeps its own look",
    back.studios.find((s) => s.id === second.data.id)?.theme === "sage" && back.studios.find((s) => s.id === cityInkId)?.theme !== "sage");
  check("the switch follows the account to the laptop", (await laptop.query("account.me")).data?.currentStudioId === cityInkId);
  check("the connected studio can't be deleted", (await brad.mutate("studios.remove", { id: cityInkId })).status === 400);
  check("another one can", (await brad.mutate("studios.remove", { id: second.data.id })).status === 200);
  check("a bad accent is refused", (await brad.mutate("studios.setAppearance", { id: cityInkId, accent: "red; background:url(x)" })).status === 400);

  /* ---------- images ---------- */
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEIGBmgAAYAIDgCAUMRSTsAAAAASUVORK5CYII=",
    "base64"
  );
  const up = await brad.raw("POST", "/api/brand", { kind: "logo", dataUrl: `data:image/png;base64,${png.toString("base64")}` });
  check("a logo uploads", up.status === 200 && /^\/api\/brand\/[0-9a-f]{40}$/.test(up.json?.url ?? ""), JSON.stringify(up));
  const served = await fetch(`${BASE}${up.json?.url}`);
  check("and is served back as an image", served.status === 200 && served.headers.get("content-type") === "image/png");
  await brad.mutate("studios.setImage", { id: cityInkId, which: "logo", assetId: up.json?.id });
  check("and sticks to the studio", (await brad.query("account.me")).data?.studios?.find((s) => s.id === cityInkId)?.logoUrl === up.json?.url);
  const svg = await brad.raw("POST", "/api/brand", { kind: "logo", dataUrl: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}` });
  check("an SVG is refused", svg.status === 415, JSON.stringify(svg));
  const junk = await brad.raw("POST", "/api/brand", { kind: "cover", dataUrl: `data:image/jpeg;base64,${Buffer.from("hello").toString("base64")}` });
  check("so is a file that isn't really an image", junk.status === 415, JSON.stringify(junk));
  check("uploading needs an account", (await anon.raw("POST", "/api/brand", { kind: "logo", dataUrl: `data:image/png;base64,${png.toString("base64")}` })).status === 401);
  const strangerUp = await stranger.raw("POST", "/api/brand", { kind: "logo", dataUrl: `data:image/png;base64,${png.toString("base64")}` });
  check("you can't put someone else's image on your studio",
    (await brad.mutate("studios.setImage", { id: cityInkId, which: "cover", assetId: strangerUp.json?.id })).status === 403);
  await brad.mutate("account.setAvatar", { assetId: up.json?.id });
  check("a profile picture", (await brad.query("account.me")).data?.user?.avatarUrl === up.json?.url);

  /* ---------- password change, logout, expiry ---------- */
  check("changing the password needs the old one", (await brad.mutate("account.changePassword", { current: "wrong", next: "new password 1" })).status === 401);
  check("with it, it changes", (await brad.mutate("account.changePassword", { current: "correct horse", next: "new password 1" })).status === 200);
  check("this browser stays signed in", (await brad.query("account.me")).data?.user?.email === "brad@example.com");
  const laptopMe = await laptop.query("account.me");
  check("other browsers are signed out", laptopMe.data?.user === null && laptopMe.data?.expired === true, JSON.stringify(laptopMe.data));
  check("the old password no longer works", (await browser().mutate("account.login", { email: "brad@example.com", password: "correct horse" })).status === 401);
  check("the new one does", (await browser().mutate("account.login", { email: "brad@example.com", password: "new password 1" })).status === 200);

  const phone = browser();
  await phone.mutate("account.login", { email: "brad@example.com", password: "new password 1" });
  await sql.query("UPDATE sessions SET expires_at = NOW() - INTERVAL 1 MINUTE");
  const expired = await phone.query("account.me");
  check("an expired session says so", expired.data?.user === null && expired.data?.expired === true, JSON.stringify(expired.data));
  check("and reads nothing", (await phone.query("conversations.list")).status === 401);

  const tab = browser();
  await tab.mutate("account.login", { email: "late@example.com", password: "latecomer1" });
  const stolen = tab.cookie;
  await tab.mutate("account.logout");
  check("logging out signs you out", (await tab.query("account.me")).data?.user === null);
  const replay = browser();
  replay.cookie = stolen;
  check("and the old cookie is dead", (await replay.query("account.me")).data?.user === null);

  const fresh = browser();
  await fresh.mutate("account.login", { email: "late@example.com", password: "latecomer1" });
  const token = decodeURIComponent(fresh.cookie.split("=")[1] ?? "");
  const [rows] = await sql.query("SELECT id FROM sessions");
  const hashed = crypto.createHash("sha256").update(token).digest("hex");
  check("sessions are stored hashed, never as the cookie",
    !!token && rows.some((r) => r.id === hashed) && !rows.some((r) => r.id === token), `${rows.length} rows`);
  const [[userRow]] = await sql.query("SELECT password_hash FROM users WHERE email = 'brad@example.com'");
  check("passwords are stored hashed", /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/.test(userRow.password_hash) && !userRow.password_hash.includes("new password"));
} finally {
  server.kill();
  await sql.end();
}

if (failures) console.log(serverLog.split("\n").filter((l) => /error|Error|fail/i.test(l)).slice(-20).join("\n"));
console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
