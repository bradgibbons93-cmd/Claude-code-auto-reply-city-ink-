# City Ink Tattoo Geelong — working notes

Read this before changing anything. It is the context a new session would
otherwise spend an afternoon rediscovering, and several entries are things
that were got wrong first and cost real customer messages.

## What this is

A Messenger and Instagram inbox for one tattoo studio in Geelong, plus a
posting dashboard. Brad Gibbons owns the studio and is the only user.

**Nothing reaches a customer without Brad approving it.** Every reply is a
draft that waits in the dashboard. This is the product, not a safety setting —
don't add an auto-send path without asking him directly.

## Where it lives

| | |
|---|---|
| Dashboard | https://claude-code-auto-reply-city-ink-production.up.railway.app |
| Hosting | Railway, project `empathetic-playfulness`, service `Claude-code-auto-reply-city-ink-` |
| Deploys from | the branch `claude/new-session-l55euv`, **not** `main` |
| Database | a separate Railway MySQL service |

Railway auto-deploys that branch on push. Merging to `main` does not deploy —
pushing the branch does.

**Send Brad the dashboard link every time something ships.** He asked for it
directly. He is on a phone, the link is not memorised, and a fix he cannot
reach is a fix that did not happen. Confirm the Railway deploy succeeded
first — a link to a broken build is worse than no link.

## Things that will waste your time if you don't know them

**Address Facebook as `/me`, never the saved Page ID.** A hand-typed Page ID
was wrong for weeks. Sending worked (it already used `/me`) while every read
failed with "Object with ID … does not exist". `getPageIdentity()` now
corrects the stored ID from the token itself.

**Railway keeps logs per deployment.** Reading only the current one gives a
false picture — that mistake produced a confident, wrong claim that Facebook
had never delivered a webhook, when in fact a 25-hour outage had caused
Facebook to drop the Page subscription.

**The per-person profile lookup (`GET /{psid}`) does not work for this app and
never will.** Names come from the Page inbox (`/me/conversations`). Don't
"fix" the lookup; it's expected to fail.

**"Facebook user" is not a name.** Meta returns it when it won't release a
profile. Storing it makes the thread look named, so the backfill skips it
forever. `isPlaceholderName()` in `db.ts` guards this.

**Meta has two Instagram flows and their tokens are not interchangeable.** A
Page token with Instagram permissions talks to `graph.facebook.com`; an
Instagram-login token talks to `graph.instagram.com` and Page endpoints refuse
it. `endpointFor(platform)` handles both. Instagram has its own token column
so it can't clobber Messenger's.

The trap: Meta's **Instagram settings** page, inside the *Messenger* product,
has a "Generate token" button per Page — and it hands back a **Page** token.
Pasting that into the box marked "Instagram access token" is the obvious move
and used to route every Instagram call to `graph.instagram.com`, which refuses
Page tokens outright; Instagram would go silent with a token saved on screen.
`instagramTokenHost()` asks `debug_token` at save time and stores which host
the token belongs to, so the routing follows what it *is*, not which box it
went in.

**Facebook fetches post images from this app's own URL, with no cookie.** With
`DASHBOARD_PASSWORD` set, `/api/attachments/:id` would 401 and every photo
post would fail silently. `signAssetPath()` issues a one-hour signed link for
exactly the image being published.

**A message with no text is still a message.** Photo-only and shared-link
messages are the commonest tattoo enquiries there are. Both were being dropped
at different points; don't reintroduce a `!text` guard.

**Thread clocks only move forward**, to when the message was actually sent.
Stamping `now()` on import made a hundred threads all read the same age and
destroyed the inbox order.

## The login

Off unless `DASHBOARD_PASSWORD` is set in Railway. Deliberately dormant while
Meta reviews the app — the App Review submission states no sign-in is needed,
and a password box appearing under a reviewer is a rejection. Turn it on once
approval lands.

Never guarded: Meta's webhook, `POST /api/uploads` and the `/upload` page (the
artists reach it by QR code on the studio wall), `/health`.

## Meta App Review

Submitted, pending. Requested: `instagram_business_basic`,
`instagram_business_manage_messages`, `pages_messaging`, `pages_show_list`,
Human Agent. The submission says this is an internal tool for one studio and
is not sold to other businesses — **that must stay true**, or the approval is
at risk. Selling it to other studios needs multi-tenant work and the Instagram
Business Login OAuth flow first.

**`pages_read_engagement` was not in the submission, and the Live feed cannot
work until it is granted.** This was got wrong once, at length: Brad was told
three times to regenerate his Page token with the permission ticked. He did,
correctly, and the feed still returned `(#10) requires 'pages_read_engagement'
or the 'Page Public Content Access' feature` — with `debug_token` confirming a
valid Page token carrying the permission.

A permission lives in **two** places. On the token, where the person grants it
in the login dialog. And on the app, where Meta decides whether the app may use
it at all (App Review → Permissions and Features). Only the first is visible in
the Access Token Debugger, and only the first is changed by pasting a new token.
When a scope is present on a valid token and Graph refuses anyway, it is always
the second — don't send anyone back to the Graph API Explorer.

**`pages_manage_posts` is missing too, and it blocks publishing.** Same story,
found later: a scheduled post failed with `(#200) The permission(s)
pages_manage_posts are not available`. It is on neither the token nor the app.
Both it and `pages_read_engagement` need requesting under App Review →
Permissions and Features. `explainPublishFailure()` says so on the post card
rather than printing Graph's own ungrammatical sentence.

`/me/posts` is also the wrong edge for a Page's own posts; `published_posts` is
the documented one, with `feed` as the older equivalent. `syncFeed` tries all
three. That wasn't the cause here, but it would have been on some Pages.

## Testing

There is no CI. Suites live in the session scratchpad, not the repo, and run
against a real MariaDB with stand-in Graph and LLM servers on localhost.
Pattern worth keeping: stand up a fake `graph.facebook.com` on a port, point
`FACEBOOK_GRAPH_URL` at it, and drive the real server. Webhook deliveries must
be **HMAC-signed with the app secret** or they're rejected — an unsigned test
looks like a broken app.

Verify in a browser with Playwright (Chromium at `/opt/pw-browsers/chromium`).
Don't use `waitUntil: "networkidle"` — Google Fonts is blocked in the sandbox
and it never settles.

## Working with Brad

He runs a tattoo studio; he is not a developer, and screenshots are how he
reports bugs. Read them closely — several of the worst bugs in this codebase
were visible in a screenshot before anyone understood them.

He has said: *"I shouldn't have to guide you. You should test it after you do
something and see if it works."* Take that seriously. Test against a real
database and a real browser before saying something works.

When he pushes back on a diagnosis, he has usually been right.
