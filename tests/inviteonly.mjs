// City Ink's own deployment: private, one studio, invite-only.
//
// The Meta app City Ink runs on was approved as "an internal tool for one
// studio, not sold to other businesses" (CLAUDE.md, Meta App Review). A public
// "Create your studio" on that address would make that untrue. So unless
// PUBLIC_SIGNUP is set, nobody can make an account — except the owner, once,
// with the studio's claim code, which links the existing inbox to them in the
// same step. After that the door is shut.
//
// Runs the built server against its own database, on UTC.
import { spawn } from "node:child_process";

process.env.TZ = "UTC";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ADMIN = process.env.DATABASE_URL || "mysql://ci:ci@127.0.0.1:3306/cityink";
const DB = ADMIN.replace(/\/[^/]*$/, "/runnit_invite");
const PORT = 4700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = "the-studio-code-123";

const mysql = (await import(`${ROOT}/node_modules/mysql2/promise.js`)).default;
const admin = await mysql.createConnection(ADMIN);
await admin.query("DROP DATABASE IF EXISTS runnit_invite");
await admin.query("CREATE DATABASE runnit_invite");
await admin.end();

// Boot once to build the tables, then give it City Ink's history and boot again,
// which is what a deploy onto the live database looks like.
async function boot(env) {
  const server = spawn("node", ["dist/server/index.js"], {
    cwd: ROOT,
    env: { ...process.env, TZ: "UTC", PORT: String(PORT), DATABASE_URL: DB, FACEBOOK_GRAPH_URL: "http://127.0.0.1:1", LLM_API_KEY: "", NODE_ENV: "test", PUBLIC_SIGNUP: "", DASHBOARD_PASSWORD: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 80 && !/Schema ready/.test(log); i++) await new Promise((r) => setTimeout(r, 250));
  return { server, log: () => log };
}

let first = await boot({});
first.server.kill();
await new Promise((r) => setTimeout(r, 500));
const sql = await mysql.createConnection(DB);
await sql.query(
  `INSERT INTO facebook_config (page_id, page_name, page_access_token, app_id, app_secret, webhook_verify_token, is_configured)
   VALUES ('P1', 'City Ink Tattoo', 'tok', 'app', 'secret', 'verify', 1)`
);
await sql.query("INSERT INTO messenger_conversations (conversation_id, sender_name, platform, last_message_at) VALUES ('c1','A Customer','instagram',NOW())");

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — ${extra}`}`);
  if (!ok) failures++;
};

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
    const json = await res.json().catch(() => ({}));
    return { status: res.status, data: json?.result?.data, error: json?.error?.message };
  };
  return {
    query: (p) => call("GET", `/api/trpc/${p}`),
    mutate: (p, b) => call("POST", `/api/trpc/${p}`, b ?? {}),
  };
}

// No code configured at all: the door is locked, and the log says how to open it.
let run = await boot({});
try {
  const anon = browser();
  const me = (await anon.query("account.me")).data;
  check("with no code set, nobody can sign up", me?.signupsOpen === false && me?.inviteOnly === false, JSON.stringify(me));
  check("and the log says exactly what to set", /Set STUDIO_CLAIM_CODE in Railway/.test(run.log()), run.log().slice(-300));
  const tried = await anon.mutate("account.signup", { name: "X", email: "x@example.com", password: "password123", code: "anything" });
  check("a sign-up attempt is refused", tried.status === 403, JSON.stringify(tried));
} finally {
  run.server.kill();
  await new Promise((r) => setTimeout(r, 500));
}

// The owner's code is set: exactly one way in.
run = await boot({ STUDIO_CLAIM_CODE: CODE });
try {
  const anon = browser();
  const me = (await anon.query("account.me")).data;
  check("sign-up isn't public", me?.signupsOpen === false);
  check("but the studio can be claimed with its code", me?.inviteOnly === true && me?.claimable?.name === "City Ink Tattoo", JSON.stringify(me));

  const noCode = await anon.mutate("account.signup", { name: "Stranger", email: "s@example.com", password: "password123" });
  check("no code, no account", noCode.status === 401, JSON.stringify(noCode));
  const wrong = await anon.mutate("account.signup", { name: "Stranger", email: "s@example.com", password: "password123", code: "guess" });
  check("a wrong code, no account", wrong.status === 401 && /studio code/.test(wrong.error ?? ""), JSON.stringify(wrong));
  const [[{ n: none }]] = await sql.query("SELECT COUNT(*) AS n FROM users");
  check("and nothing was created by trying", Number(none) === 0);

  const brad = browser();
  const joined = await brad.mutate("account.signup", { name: "Brad", email: "brad@example.com", password: "password123", code: CODE });
  check("the owner signs up with the code", joined.status === 200, JSON.stringify(joined).slice(0, 200));
  check("and City Ink is theirs in the same step", joined.data?.studios?.[0]?.name === "City Ink Tattoo" && joined.data?.studios?.[0]?.connected === true);
  check("setup still runs, to fill in the rest", joined.data?.user?.onboardingComplete === false);
  const inbox = await brad.query("conversations.list");
  check("with the inbox already readable", inbox.status === 200 && inbox.data?.length === 1, JSON.stringify(inbox).slice(0, 120));

  const after = (await browser().query("account.me")).data;
  check("then the door is shut", after?.inviteOnly === false && after?.claimable === null, JSON.stringify(after));
  const late = await browser().mutate("account.signup", { name: "Late", email: "late@example.com", password: "password123", code: CODE });
  check("even with the same code", late.status === 403, JSON.stringify(late));
} finally {
  run.server.kill();
  await sql.end();
}

console.log(failures ? `\n${failures} failed` : "\nall good");
process.exit(failures ? 1 : 0);
