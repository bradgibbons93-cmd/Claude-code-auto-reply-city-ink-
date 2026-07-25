# City Ink — Front of House

A Facebook Messenger agent and posting dashboard for City Ink tattoo studio.

Answers customer DMs with the studio's own facts, sends the Timely booking link when
someone actually wants an appointment, gets out of the way when a person takes over
a thread, and publishes scheduled posts to the Page.

---

## What changed from the previous code

The old build had eight faults that would have shown up as real customer-facing
problems. All eight are fixed, and each fix is commented in place.

| | Was | Now |
|---|---|---|
| 1 | Signature hashed `JSON.stringify(req.body)` — a re-serialisation, not the signed bytes | Raw body captured in `express.json({ verify })`, hashed as-is |
| 2 | `timingSafeEqual` threw on a malformed header | Length checked first, returns `false` |
| 3 | Facebook waited for the whole AI round-trip, timed out, retried | `200` returns immediately, work happens after |
| 4 | No dedupe, so retries double-replied | Unique index on `message_id`; a repeat delivery stops dead |
| 5 | Echo events unfiltered — the agent could answer itself | `is_echo` filtered; an echo with no `app_id` means a human typed it |
| 6 | Booking keywords included "when", "time", "price", "cost" | The model classifies intent; only `booking` sends the link |
| 7 | No conversation memory — every reply forgot the last | Last 10 turns loaded and passed to the model |
| 8 | No human handoff | Studio replies from Page Inbox pause the agent for 12 hours |

The old `crypto` npm dependency is gone — it was a deprecated shim of the Node builtin.

---

## Setup

**1. Install and configure**

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — a MySQL 8 database
- `LLM_API_KEY` — Anthropic by default; set `LLM_PROVIDER=openai` for anything
  OpenAI-compatible and point `LLM_BASE_URL` at it

**2. Create the tables**

```bash
npm run db:push
```

**3. Run it**

```bash
npm run dev        # API on :3000, dashboard on :5173
```

**4. Connect the Page**

Open the dashboard → **Settings**. Paste the Page ID, page access token, app ID,
app secret, and a verify token you make up. Then add the Timely booking URL, and
fill in **What the agent knows** — hours, deposit policy, minimum age. The agent
will not invent anything you haven't put there.

**5. Point Facebook at the webhook**

In your Meta app → Messenger → Settings → Webhooks:

- Callback URL: `https://your-domain/api/webhook/facebook`
- Verify token: whatever you entered in Settings
- Subscribe to: `messages`, `messaging_postbacks`, `message_echoes`

`message_echoes` is what makes the human handoff work. Without it the agent will
talk over the top of you.

---

## Deploying

You said you hadn't picked a host. **Railway** is the least friction here: it gives
you MySQL and the Node service in one project, and you get an HTTPS URL immediately,
which Facebook requires for webhooks.

```bash
npm run build
npm start
```

Set every variable from `.env.example` in the host's environment settings, and set
`NODE_ENV=production` so the built dashboard is served from the same process.

Render works too, but its MySQL story is worse — you'd want PlanetScale or Aiven
alongside it. Manus is fine for the API but you'd still need a MySQL host.

---

## Before it can message the public

The agent will only reply to people with a role on your Meta app until you have
`pages_messaging` approved through App Review. Budget real time for this — it is the
long pole, not the code.

Facebook also blocks messages sent more than 24 hours after the customer's last
message unless you use an approved message tag. Nothing here tries to route around
that.

---

## Layout

```
src/server/
  agent.ts      the actual agent — memory, intent, handoff
  facebook.ts   Graph API, signature verification, publishing
  llm.ts        provider-agnostic model calls
  db.ts         all queries
  scheduler.ts  publishes due posts every minute
  routes/       the webhook
src/drizzle/    schema
src/client/     dashboard
```

## Endpoints

- `GET /api/webhook/facebook` — verification handshake
- `POST /api/webhook/facebook` — incoming events
- `GET /health` — connection status, no secrets
