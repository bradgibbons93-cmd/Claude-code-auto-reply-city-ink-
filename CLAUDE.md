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

**Instagram signs its webhooks with a different app secret from Facebook's.**
This is what "it's still not pulling messages" actually was, after two days of
token and permission chases. Every rejected delivery in the logs was
`object=instagram`, several carrying real DMs, and not one was `object=page` —
Messenger was never broken, it was quiet, because the studio's customers use
Instagram. The webhook now accepts a delivery signed by either the Facebook or
the Instagram app secret; both are the studio's own credentials, and a forgery
still matches neither. `instagram_app_secret` has its own box in Settings.

**"Rejected: bad signature" means messages are arriving and being binned.**
Not that Facebook is quiet — the opposite. It means the saved `app_secret`
doesn't match the one Meta signs with, and every real enquiry is being 403'd
while the dashboard shows zero messages and every other panel reads green.
Facebook retries, so the log fills up. Never weaken the check; the fix is to
re-paste the App secret. The count is stored on `facebook_config` and shown at
the top of the delivery panel, because forty rejections an hour is a diagnosis
and a silent 403 is not.

**The app pulls the inbox every three minutes; it does not only wait to be
pushed to.** Three separate faults in two days each broke Facebook's push and
each produced the identical symptom — an inbox that quietly stopped. An
expired token, a subscription Facebook had dropped, and a stale `app_secret`
that 403'd every delivery. Fixing one never protected against the next, so
`scheduler.ts` polls `importExistingConversations(30)` and drafts only for
threads whose last message is under thirty minutes old. The webhook is still
the fast path; this is the floor under it. Both are idempotent on
`message_id`, so they cannot duplicate each other — there is a test for
exactly that.

**Thread clocks only move forward**, to when the message was actually sent.
Stamping `now()` on import made a hundred threads all read the same age and
destroyed the inbox order.

**Notifications go to the phone by web push, not through Messenger.** The
Messenger ping to `ownerPsid` is still there and still fires, but it only
works inside Facebook's 24-hour window — which is closed exactly when the
studio has been quiet, so the one channel went silent when it mattered most.
`push.ts` holds a VAPID keypair in `app_settings`, **generated once**:
regenerating it silently orphans every subscription already handed out, and
the switch in Settings still reads "on" while nothing ever arrives again.

On an **iPhone the dashboard has to be added to the home screen** before a
push can be delivered at all — Apple's rule, and there is no error to read,
the API simply isn't there. `pushReadiness()` says so in a sentence instead of
letting the button fail silently. That is what `manifest.webmanifest`, `sw.js`
and the two icons in `public/` are for.

One buzz per thread, claimed in the database (`claimNotificationSlot`), not in
memory — four reference photos is one enquiry, and four buzzes is how someone
learns to swipe the buzz away without reading it.

**An empty draft is deliberate when `llmFailed` is set.** The card appears
with an empty box so the studio writes the reply themselves; a placeholder
there would be worse, because a placeholder can be approved by accident.
Empty drafts *without* that flag are refused. Three suites exist purely to
hold that line — don't "fix" the empty box.

**Gallery photos are publishable now, and both halves were broken.**
`posts.create` rejected `/api/uploads/…` even though the picker offered it,
and the route was `requireStudio` rather than `requireStudioOrSignedLink`, so
Facebook's own fetch of the picture would have 401'd behind a password. Same
trap as `/api/attachments/`, one route later.

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

**Instagram refuses a page it thinks is too big, and how big is not a fixed
number.** Twenty-five was reduced to eight and the live server still logged
`HTTP 500: Please reduce the amount of data you're asking for` every three
minutes. Guessing a smaller number has now failed twice, so `getShrinking()`
halves the page and asks again, down to one, on that error only. Messenger
keeps its full page and never sees this.

**The header search box searches message text, not just names.** The studio
remembers "the bloke who wanted the koi on his forearm" long before it
remembers his name. LIKE, not the FULLTEXT index, on purpose: that index drops
a word appearing in over half the rows, which is every word a tattoo studio
would search for. A result opens `/messages?thread=…`, so a thread is
linkable and survives a refresh.

## The palette

Coffee brown `#6F5A4B` and silver gray `#E9E9EA`, off the sheet Brad sent,
with the logo's ink black `#1A1A1A` carrying the type. Light theme: silver
ground, coffee for anything that has to be looked at. Dark theme: espresso
ground, the silver as the type, the coffee lifted to read against it — it was
violet before, which was a third colour the studio doesn't own.

Everything resolves through CSS variables in `index.css`, so **don't reach for
a Tailwind palette colour** (`blue-500`, `purple-400`) in a component. Three
of those had crept in and were the only non-brand colours on the page.

## Testing

There is no CI. Suites live in the session scratchpad, not the repo, and run
against a real MariaDB with stand-in Graph and LLM servers on localhost.
Pattern worth keeping: stand up a fake `graph.facebook.com` on a port, point
`FACEBOOK_GRAPH_URL` at it, and drive the real server. Webhook deliveries must
be **HMAC-signed with the app secret** or they're rejected — an unsigned test
looks like a broken app.

Verify in a browser with Playwright (Chromium at `/opt/pw-browsers/chromium`;
install it with `npm install --no-save playwright` — it is not a dependency).
Don't use `waitUntil: "networkidle"` — Google Fonts is blocked in the sandbox
and it never settles.

**`IG_GRAPH` falls back to `FACEBOOK_GRAPH_URL`** so one stand-in server can
serve both hosts — which also means the code correctly concludes it is already
on Instagram's host and drops the `platform` parameter. A suite that tells the
two inboxes apart by that parameter will see everything as Instagram. Tell
them apart by the `fields` they ask for instead (Messenger takes 100 messages
a thread, Instagram 10).

**`pkill -f "dist/server/index.js"` kills your own shell**, because the
pattern matches the very command line that contains it. Cost half an hour of
tool calls returning exit 1 with no output. Start each run on a fresh port
instead, or keep the PID.

**web-push always speaks https**, whatever the endpoint's scheme says, so a
stand-in push service has to be a TLS server with a self-signed certificate
and `NODE_TLS_REJECT_UNAUTHORIZED=0` in the test process only. Against a plain
`http://` listener it fails with an OpenSSL "packet length too long", which
reads like a bug in the app and isn't.

## Working with Brad

He runs a tattoo studio; he is not a developer, and screenshots are how he
reports bugs. Read them closely — several of the worst bugs in this codebase
were visible in a screenshot before anyone understood them.

He has said: *"I shouldn't have to guide you. You should test it after you do
something and see if it works."* Take that seriously. Test against a real
database and a real browser before saying something works.

When he pushes back on a diagnosis, he has usually been right.
