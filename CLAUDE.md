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

**The poll drafts for anything unanswered in the last 24 hours, not 30
minutes.** Half an hour only ever covered the gap between a webhook arriving
and being handled; as the real safety net it was useless, because a message
that failed to draft at 10am was out of range before anyone noticed. Ten per
run, so a backlog trickles onto the board.

**The three-minute poll's draft pass must not depend on the import.** It did:
`if (!messages) return;` sat between them, so drafting ran only when the
import had found new messages. Messages normally arrive by webhook and are
already stored by the time the import looks, so it finds nothing and the
draft pass was skipped on the healthy path — and for Instagram, whose import
Meta refuses outright, it never ran at all. The one safety net in the app
only ran when it was least needed. They are two independent jobs now, each
with its own try/catch.

**The handoff pause must never swallow a new customer message.** Answering
someone by hand from Meta's own inbox fires an echo, which paused the thread
for twelve hours — so when the customer wrote back there was no draft, no
notification, and a dashboard reading "All caught up" over an Instagram inbox
with three unread. Brad works his inbox by hand all day, so this muted
essentially every live conversation.

Nothing in this app reaches a customer without approval, so withholding the
*draft* bought nothing and only removed the help. `bot_pause_reason` now
separates the two cases: `handoff` lifts the moment the customer speaks again,
`manual` (the Pause button) is obeyed until it expires. `getUnansweredConversations`
makes the same distinction, and `liftStaleHandoffPauses()` releases threads
already stuck, once, on boot — those messages have no second webhook coming.

**Ask for a name down the inbox the thread actually came from.** The backfill
called `getSenderProfile(conversationId)` with no platform, so every Instagram
thread was asked for over the Messenger path — and the Instagram permission
error that came back was then recorded against Facebook, whose lookups do
work. `getConversationsMissingNamesWithPlatform()` carries the inbox, and the
refusal is filed by what the error names rather than by what the caller
claimed.

**Meta will not name anyone to this app on Instagram, and asking costs three
calls per person.** Twelve unnamed threads made three dozen guaranteed
failures every couple of minutes, and the real faults were unreadable in the
red. `getSenderProfile` believes a permission refusal for an hour, per
platform, and says so once. It recovers by itself when Advanced Access lands.

**Who spoke last is decided by when a message was SAID, never by row id.**
`MAX(id)` is insert order, and insert order is not message order — a thread
pulled in across two imports can have an older message on a higher id. Two
queries used it while every other reader ordered by `created_at`, so they
disagreed with the thread view. That is how a June enquiry the studio had
already answered by hand came back onto the board as unanswered, and how
genuinely new ones sat in "waiting on them" and were never drafted for. Both
symptoms, one cause.

**A reply to a story the studio tagged someone in means they are ALREADY
tattooed.** Brad, with two screenshots — the draft, and what he replaced it
with:

> she was already tattooed and she wrote she loved the tattoo from the story
> that we tagged her in

The customer wrote "I love it! Thank you !!" and the agent answered "let us
know when your ready and we can look at getting you booked in!" — to someone
who had just been in the chair. He changed it to "Hope to see you again in
the future!"

This is the studio's commonest Instagram message and it is not an enquiry.
The studio posts the finished work to a story and tags the client; the client
replies to the story. A short warm message with no question in it — "I love
it", "thank you", hearts — is a thank-you. Offering to book them reads as
though nobody read it. The prompt says so in those words now, and still
treats an actual question (a price, a date, another piece) as a real enquiry.

**The poll wrote a new draft and never cleared the old one, so a customer had
two — and the board showed the wrong one.** Brad, with three screenshots: the
card dated "1 day ago" carrying the question he had already answered by hand
at 00:48, with a price drafted against it, while her real message from 17:35
("Thank you ❤️. I'm thinking roughly same size as this?") was nowhere. He
assumed the page was stale. It wasn't — **the draft inside the card was
answering the wrong message.**

`handleCustomerMessage` has always called `supersedePendingReplies` first —
that is the "Replaced 1 stale draft(s)" line in the log. `draftForUnanswered`
never did. So a customer drafted for yesterday, answered by hand, and writing
again got two pending rows, and `getPendingReplies` (one card per person) had
to pick between them.

Both paths supersede now, and the poll logs which message it is drafting
against — id, first sixty characters, and when it was said — because "which
message is this card actually about" was the question that could not be
answered from the outside.

**The thread view asked for the OLDEST fifty messages, so a long
conversation showed the studio ancient history.** Brad, with two screenshots:
Maureen's card headed

> THEY SAID: When you get a chance, I would like to request quote for those
> please

dated two days ago, above a draft that correctly answered what she had asked
twenty minutes earlier ("Does that include the 'P' by any chance?"). His
words: *"The reply we drafted is right, but I'm only seeing her last message
before the most recent one, it should always show her most recent message."*

`getConversationMessages` ordered ASC and then `LIMIT 50` — which on a thread
with more than fifty messages returns the first fifty ever sent and drops
everything since. The card looks up the message its draft was written for;
that message wasn't in the window, so the client fell back to "the newest
customer message I can see", and on a truncated window that is whatever was
being said days ago.

`getRecentTurns`, which is what the agent reads, had always taken the newest
and reversed. That is exactly why the draft was right and the heading above it
was wrong — two readers of the same thread, one of them looking at the wrong
end of it. DESC, limit, then reverse, so callers still get oldest-first.

**A refresh button and "Updated 12s ago" sit above the board.** It already
refetched every ten seconds; there was simply no way to SEE that, so a wrong
card was indistinguishable from an old one and the first suspicion was always
the page rather than the data. Cheap, and it removes a whole category of
doubt.

**"A draft is already waiting" meant two different things in two queries, and
a customer fell down the gap.** This is what Brad was actually looking at when
he asked why Maureen's message wasn't showing.

`getPendingReplies` (the board) hides a draft once the studio has said
anything in that thread after it was written — the reply was given by hand,
so the draft is stale. Correct. But the row stays `status='pending'` for ever.

`getUnansweredConversations` (the poll) counted that same row. So when the
customer wrote back the next day, the poll saw "she already has a draft
waiting" and wrote nothing, while the board went on hiding the stale draft it
was pointing at. **Invisible from both directions at once**, with her message
sitting in Meta's inbox and the dashboard reading "Waiting for your OK (1)"
over somebody else.

This hits hardest for exactly this studio, because Brad answers people by hand
all day: every thread he touches leaves a permanently 'pending' row behind
that silences the next message on it.

The poll now uses the board's definition — a draft only counts if nothing of
ours came after it. Both queries agree, and `explainNotUnanswered()` tells the
two cases apart in the log ("a draft is already waiting" versus "only a stale
draft, superseded by our own reply").

**Stored is not handled. The webhook must not return just because the poll
got there first.** Brad: *"why is maureens message not showing up?"* — a real
customer, a real question, on the board nowhere. The live log, 17:36:

    [Agent] Message from 9182505141836612 (Maureen Lopez), conversation row 45
    [Agent] Duplicate delivery ignored: m_RmTk1WxbzhYK5CMs6afGh…

The three-minute Messenger import reached her message a few seconds before
Facebook's webhook did and stored it. So when the webhook arrived the insert
hit the unique index on `message_id`, `handleCustomerMessage` returned — and
everything downstream of that line never ran: the phone was not buzzed, the
`handoff` pause from the studio's own earlier reply was never lifted, and
nothing was drafted. The poll then skipped the thread because it was still
paused, and `draftForUnanswered` reported nothing to do.

Every part behaved exactly as written. The message was in the database the
whole time and the dashboard said everyone had been answered.

The dedupe now only decides whether to STORE. Whether to HANDLE is a separate
question, answered by `hasDraftForMessage()` — has this exact message ever
been drafted for, in any state. A genuine Facebook retry still stops (or
approving a draft and receiving the delivery again would throw away the
version the studio edited); a message that was merely stored early is picked
up and handled.

This is the third time on this project that the fast path and the safety net
have each assumed the other did the work. When something is missing from the
board, check whether it is missing from the *database* before assuming it
never arrived — it usually did.

**The studio answers plenty of messages from Meta's own inbox, where this app
cannot see them.** Echoes cover it going forward; anything older is only known
if it was imported. So "Draft the unanswered" is bounded to a fortnight — it
used to reach back over everything ever stored — and any draft answering a
message over two weeks old carries a warning on the card.

**A draft is claimed before it is sent, so a failed send has to put it back.**
It didn't, and that is the worst bug this app has had: approving marked the
draft resolved and only then tried to send, so when Meta refused, the card
vanished looking exactly like a reply that had gone and the customer was never
answered by anyone. `restorePendingReply` puts it back with `send_error` on it,
and the card says so in red.

**Messenger sending WORKS. Instagram sending is the only thing blocked.**
Brad, correcting this file after days of it being wrong:

> it's not only users with admin access I can reply to, the reply actually
> sends to anyone that has messaged in from messenger just not instagram

He is right, and this entry used to say the opposite — that under Standard
Access no reply had ever reached a customer on either inbox. That framing was
wrong and it was expensive: it sent days into "why can't we message anyone"
when the real question was always "why can't we message on Instagram".

What is actually true:

- **Messenger**: Standard Access lets a Page reply to anyone who messaged it
  first. Replies reach real customers today. Nothing is waiting on approval
  for Messenger. A Messenger send that fails does so for a *window* reason —
  more than 24 hours (or 7 with the Human Agent tag) since they last wrote —
  not a permission one.
- **Instagram**: refused, every time, on one named permission:
  `(#200) App does not have Advanced Access to instagram_manage_messages`.
  That is the whole blocker, and it is the permission the submission does not
  ask for.

`explainSendFailure()` takes the platform now and says which inbox is
blocked, and that the other one still works. It used to say the app "can only
message people with a role on the app", which reads as nothing reaching any
customer anywhere — the sentence that started the wrong hunt. `sendfail.mjs`
asserted that wording, so the test was holding the mistake in place; it now
asserts the opposite, on an Instagram thread, which is what production
actually does.

**Instagram messages ARRIVE fine.** Brad confirmed this too. Do not conclude
otherwise from `devtools_webhook_list`, which reported only the `page` topic
— reading that as "Instagram webhooks were never subscribed" was another
wrong turn on the same day. The DMs come in; only the replies are refused.

**Log Graph's raw words next to every explanation.** The send path logged only
the sentence built from the error, which is precisely the mistake that put
three days into the wrong permission before — the guess was all anyone could
see. Both, always.

**Meta's standard reply window closes 24 hours after the customer's last
message**, which for a tattoo studio is the normal case, not the edge case.
Every reply here is read and approved by a person, so a refused send is retried
once under `messaging_type: "MESSAGE_TAG"` with `tag: "HUMAN_AGENT"`, which is
both what the Human Agent permission is for and true. Seven days is the ceiling
even then; past that, `explainSendFailure()` says to answer from the phone.

**A 200 from Graph is not proof anything was sent.** Check for `message_id`.

**Apple refuses a push outright if the VAPID contact isn't routable.** The
default was a `mailto:` at `.example`, a reserved domain, so every notification
to an iPhone came back 403 while the panel read "On for this iphone" and listed
the device. It defaults to the dashboard's own address now. `PUBLIC_URL` is not
set on Railway; `RAILWAY_PUBLIC_DOMAIN` is, and both `publicUrl()` and the VAPID
contact fall back to it.

**`max_tokens` has to leave room for a model that thinks before it answers.**
At 1500, Claude Sonnet 5 spent the whole budget reasoning and returned a
response with no text block at all — which surfaced as "Empty LLM response" and
read like an unreachable model. Eight of nine drafts failed in one minute. It
is 4000 now, retried once at double, and a missing text block reports
`stop_reason` and which blocks did arrive.

**Instagram says "too many conversations" as well as "reduce the amount of
data",** and they mean the same thing. Only the second was recognised, so the
shrink never engaged on the error this studio's inbox actually returns. Worse,
retrying a 40-second timeout four times outlasts the three-minute poll, so the
polls overlapped. There is a per-inbox back-off now (3 minutes doubling to 30);
**a manual Import ignores it**, because pressing the button is the instruction
to try now.

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

**An Anthropic key made under "identity federation" belongs to a person, not
to a workspace, and Anthropic refuses it until it is told which workspace to
bill.** Brad put credit on the account, pasted the new key in, and said "so it
should be all done. Right?" — and every three minutes the live server answered

    [Agent] No draft for 630621959928364 — The provider returned HTTP 400:
    {"type":"error","error":{"type":"invalid_request_error","message":
    "anthropic-workspace-id is required when authenticating with an
    identity-linked API key; send the id of the workspace this request act

with a real customer's message on the board underneath it. Nothing was wrong
with the key or the balance. That sentence is accurate and unreadable on a
phone, and it was being printed on the card verbatim, truncated mid-word — the
same shape as every other dead end here, where a wrong key, a spent account
and a wrong model all looked identical. `diagnose()` now names it and gives
both ways out: make the key on a workspace instead, or set `LLM_WORKSPACE_ID`
and the `anthropic-workspace-id` header goes with every call. The header is
only sent when there is something to send, so a normal workspace key is not
handed a blank one.

**Newer Claude models refuse a `temperature`, and Anthropic says so in a 400
that mentions the model.** This cost a whole morning. The panel read

> The provider doesn't recognise the model "claude-sonnet-5". Copy the exact
> name from its model list into LLM_MODEL.

and the name was correct. Brad was sent to change a setting that was already
right, twice, while what Anthropic actually said —

    `temperature` is deprecated for this model.

— never reached the screen at all, because `diagnose()` matched the bare word
"model" anywhere in a 400 body and returned its own guess instead. That is
precisely the mistake this file warns about for Graph, made again one file
over. An unknown model must now be a 404 or say so in words; everything else
falls through to the provider's own sentence, and the raw body is logged
beside every explanation.

The fix for the temperature itself is to ask rather than keep a list of which
models take one: send it, and if the refusal names it, drop it and ask again,
remembering the answer for the life of the process. Any other 400 is not
retried — it would fail twice and keep a customer waiting longer.

**Being on `/v1/models` is not the same as working.** The list said
`claude-sonnet-5` was available while every real call was refused. So the boot
check makes one tiny real call and logs `Model "X" answered a real call — the
agent can draft`, or the refusal with Anthropic's raw body next to it. That
line is the fastest way to know whether the AI is alive, and it is why the
morning above ended in minutes rather than another round of screenshots. A
model that isn't on the list costs no call at all.

**Switching provider is two changes — the endpoint and the key.** Doing only
the first leaves a perfectly good key being offered to a company that never
issued it, and the 401 that comes back said "check it was copied in full",
sending someone hunting for a typo that isn't there. `keyBelongsElsewhere()`
compares the key's prefix to the configured provider (`sk-ant-` Anthropic,
`sk-or-` OpenRouter) and names the mismatch. An unrecognised shape says
nothing rather than guess — a self-hosted endpoint can use any format.

**When the AI provider stops answering, the phone gets told.** Brad switched
`LLM_PROVIDER` to OpenRouter and the account ran out of credit; every enquiry
from that moment landed with an empty box and nothing said so — the poll
retried every three minutes for forty minutes with a customer waiting. The
failed-draft card now prints the actual reason instead of sending someone to
Settings to press a Test button, and `draftForUnanswered` fires a `notifyOnce`
alert when everything failed and nothing was drafted. `clearAlert("llm")` on
the next success re-arms it for the following outage.

**A waiting customer always gets a card, even when the AI can't write one.**
Brad's rule, in his words:

> make a all around the rule that no matter what, if there's a new message
> that is unrequited within the last twenty four hours, it will show

The poll used to log the model's failure and `continue` — no row, no card, no
name on the board. The customer simply vanished from the studio's screen
because the AI had a bad minute, which is the same shape as every other bug
that has cost this studio a message. `draftForUnanswered` now puts the card up
with an empty box and the `llmFailed` flag, exactly as the webhook path always
has.

Two rules hold that together, and both are tested. An empty failed card does
NOT count as "a draft is waiting", so the AI fills it in by itself on the next
pass instead of leaving the studio to notice and press a button. And the
moment anything is typed into it, `replacePendingReplyDraft` clears the flag,
so a half-written reply is Brad's and nothing may overwrite it.

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

**Nothing in this app ever deleted or compressed an image, and the MySQL
volume reached 75%.** Resizing the volume buys time; the only direction it
ever moved was up. Both halves are fixed now, and both have a trap in them.

Photos are re-encoded on the way in (`images.ts`): 1600px for a customer's
reference photo, 2048px for the studio's own work, which is what gets
published. A phone photo goes from around 7MB to about 550KB — 92% — and a
screenshot rather more. The rules exist to stop it ever making anything worse:
the aspect ratio is fixed, nothing is enlarged, a photo already under 150KB is
kept byte for byte, and if the re-encode comes out no smaller the original is
kept. `.rotate()` is called before the encode on purpose — sharp drops EXIF,
and without it every portrait photo off an iPhone comes back on its side.

**The hash is taken of the bytes that are stored, not the bytes that
arrived.** That is what keeps the content-addressing working: the same photo
sent twice still compresses to the same bytes and still lands on one row.
Hashing first and compressing after would quietly break that.

**The clear-out (`housekeeping.ts`, nightly at 16:00 UTC — 2am in Geelong)
only ever deletes rows whose `conversation_id` is 'feed' or 'post'.** A
customer's reference photo carries its thread's id and can never be selected;
we have no second copy of one, and Facebook's CDN link died months ago. On top
of that, nothing is deleted that any message, booking, scheduled post or feed
post still names. Both guards are needed, because these rows are
content-addressed: if a customer sends the studio a picture the studio itself
posted, there is ONE row and the feed may own it.

That reference scan reads ids out of `/api/attachments/…` with a pattern, and
the first version of it only matched hex. That is fine against real ids and
silently catastrophic against anything else — an id it doesn't recognise reads
as "nothing points at this". It matches loosely now: reading one id too many
protects a photo that was never at risk, reading one too few deletes a photo
there is no copy of.

**What is deliberately NOT pruned:** the artists' gallery (`artist_uploads`)
is the studio's own record of its work and the only copy there is; photos on
posts that were actually published, so the card still shows what went out; and
anything at all on a conversation. And the images already in the database are
still at their original size — compression is on ingest only. Recompressing
what is stored would rewrite customers' photos in place, irreversibly, which
is the one thing this file says not to risk; it needs Brad's say-so and a dry
run first.

**The global `express.json({ limit: "5mb" })` was refusing photos before the
routes that allow 24MB ever saw them.** It is mounted first and runs on
everything, so an artist photographing a piece on any recent phone got
Express's own HTML "Payload Too Large" page — while the code underneath
apologised with "that photo is over 8MB", which was never the reason. The two
photo routes are stepped over now and keep the limit they declare.

## The login

Off unless `DASHBOARD_PASSWORD` is set in Railway. Deliberately dormant while
Meta reviews the app — the App Review submission states no sign-in is needed,
and a password box appearing under a reviewer is a rejection. Turn it on once
approval lands.

Never guarded: Meta's webhook, `POST /api/uploads` and the `/upload` page (the
artists reach it by QR code on the studio wall), `/health`.

## Meta App Review

**What is actually broken: Instagram replies, and nothing else.** Messenger
sends reach real customers today — see the entry above. So the entire value
of App Review, for this studio, is one permission:
`instagram_manage_messages`. Everything below is the state of the submission
that is meant to grant it.

**Read from Meta's own API on 5 September, through the Meta Social
Technologies MCP. This replaces every guess above it.**

`devtools_app_review` on app **4457207527757824** ("city. nk autoi"):

    submission_status: PENDING      submitted 26 August 2026
    has_been_previously_reviewed: false      submissions: []

**It has never been reviewed.** Every permission reads `REJECTED` with
`access_level: none`, and every one of them has an EMPTY `rejection_reasons`
object — that is the default state of a permission that has never been
granted, not a decision anybody made. Nothing was turned down. Nothing has
been looked at.

**Every permission in the pending submission is missing its screencast.**
This is the finding. All seven:

    instagram_business_basic            screencast: NOT DONE
    instagram_business_manage_messages  screencast: NOT DONE
    pages_show_list                     screencast: NOT DONE
    pages_messaging                     screencast: NOT DONE   api_precheck: NOT DONE
    business_management                 screencast: NOT DONE   api_precheck: NOT DONE
    pages_read_engagement               screencast: NOT DONE   api_precheck: NOT DONE
    Human Agent                         screencast: NOT DONE

A screencast is mandatory. The submission cannot pass in this state, and it
has been sitting in the queue since 26 August waiting to fail. Everything
else is done: use case written, data use checkup complete, privacy policy
present, business verification passed, test page set.

**Two permissions the studio actually needs are NOT in the submission at
all**, which is what was suspected here for a week and is now confirmed:

- **`instagram_manage_messages`** — the exact string in every live refusal
  (`(#200) App does not have Advanced Access to instagram_manage_messages`).
  Not requested. The submission asks for `instagram_business_manage_messages`
  instead, which belongs to Meta's other Instagram flow. Note that Meta's own
  `Human Agent` prerequisites list BOTH, so both can be requested together.
- **`pages_manage_posts`** — blocks publishing a scheduled post. Not
  requested.

`pages_read_engagement` IS in the submission — an earlier note in this file
said it wasn't, and that was wrong.

**`can_submit: false` — "Cannot submit to App Review while a previous
submission is in review."** So the pending one has to be cancelled before
anything can be added to it.

### What has to happen, in order

1. Cancel the pending submission (nothing is lost — it has never been looked
   at, and it cannot pass without screencasts).
2. Add `instagram_manage_messages` and `pages_manage_posts`.
3. Record the screencast and attach it to every permission — one recording
   showing the real dashboard receiving a customer message, drafting a reply,
   and Brad approving it covers the messaging permissions.
4. Complete the API precheck for `pages_messaging`, `business_management` and
   `pages_read_engagement` (a successful call using each, in dev mode).
5. Resubmit.

The submission says this is an internal tool for one studio and is not sold to
other businesses — **that must stay true**, or the approval is at risk.
Selling it to other studios needs multi-tenant work and the Instagram Business
Login OAuth flow first.

**Four Meta apps exist on this business.** `4457207527757824` ("city. nk
autoi", Live) is the one that matters and the one the Page token belongs to —
confirmed at boot by `reportAppIdentity()`. `27106251185651300` ("City Ink
Automation - Test1") is active and unused; `2076592893274412` and
`2019468835368169` are archived.

**Meta has an MCP server and it is how all of the above was read.** The docs
give the command outright:

    claude mcp add --transport http meta_social_technologies https://mcp.facebook.com/devtools

It needs an interactive OAuth sign-in, so a remote cloud session cannot
complete it — Claude Desktop (Settings → Connectors → Add custom connector) or
a local Claude Code session, signed in as an app admin. **Use it before
guessing at anything to do with permissions again.** A week went into
inferring from error strings what `devtools_app_review` answers in one call.

**Meta cannot enumerate this account's Instagram conversations edge at all,
and no amount of asking for less has fixed it.** This has now been attempted
three ways and failed three times, so do not attempt a fourth without reading
this.

1. Twenty-five threads reduced to eight — still refused.
2. `getShrinking()` halving the page down to one — still refused.
3. The nested `messages{...attachments{...}}` sub-query removed entirely, the
   list asked for as `id,participants` and then `id` alone, ten at a time,
   with the messages fetched thread by thread afterwards — **still refused**,
   live, on 5 September:

       HTTP 400 (2534084) "Your query has timed out since you have too many
       conversations with users"
       HTTP 500 "Please reduce the amount of data you're asking for"

The third attempt was the right diagnosis of the wrong problem: the nested
sub-query really was expensive, but the cost that matters is Meta walking the
edge, which it says in as many words. Page size and field list are not the
lever. Keep the two-phase fetch — it is strictly cheaper and it is what makes
Messenger's import fast — but do not expect it to fix Instagram.

**What still works: the webhook.** Instagram DMs arrive live and are drafted
for. The import is the backfill and the safety net underneath the webhook,
and for Instagram that net has never existed. Say that plainly rather than
implying Instagram is broken — it isn't; its history is unreadable.

**The one approach not yet tried** is Meta's own documented answer to 2534084:
stop enumerating and ask for threads by person, `/me/conversations?user_id=
<IGSID>`, which returns just that conversation. The app already knows the
IGSID of everyone who has ever webhooked in, so the set of threads worth
fetching is already in the database and the edge never has to be walked.
Untested. Do not describe it as the fix until it has run against production.

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

**Not every `.mjs` in the scratchpad is a suite, and running them all reports
failures that aren't.** `stubs.mjs` is a stand-in server meant to stay
running, `clickretry.mjs` is a hand-driven probe, five `shot*.mjs` only take
screenshots, and `live.mjs` drives the real production URL, which the sandbox
proxy blocks. Running the lot reported fourteen failures and none of them was
one. `run-all.sh` knows the difference; add a new non-suite to its list.

**The browser suites expect a dashboard already listening on a fixed port** —
3114, 3115, 3120, 3140 (that one wants `DASHBOARD_PASSWORD`), 3150, 3151,
3152. They don't start one. After a container restart nothing is listening
and they fail with `ERR_CONNECTION_REFUSED`, which reads like a broken app;
the header comment in `run-all.sh` has the loop that starts them.

**`npm install --no-save X` removes anything else installed with
`--no-save`.** Playwright is not a dependency, so installing `nock` on its own
silently deleted it and six suites then failed to import a browser. Install
them together: `npm install --no-save playwright nock`.

**A suite must create the rows it asserts about, and ask only about its own.**
`verify.mjs` asserted that a conversation starts with no name — true only the
very first time it ever ran — and counted `getPendingReplies()` across the
whole board, which every other suite leaves drafts on. It passed alone, it
passed once, and it failed in the full run. That is the same mistake twice
now; it is the first thing to suspect when a suite is green by itself and red
in the run.

**`prune.mjs` needs the ids it invents to look like the ones the app writes**
— 40 hex characters off a SHA-256. Its first version used readable names like
`pt_orphan`, and every assertion about a photo being protected passed for the
wrong reason: the reference scan didn't recognise the shape, so it read
"nothing points at this" and deleted the lot. A test whose fixtures don't look
like production is testing the fixtures.

**`batche2e.mjs` and `sendfail.mjs` are intermittently flaky in a full run**
and pass reliably alone. Not yet chased down; the shared test database and
seven dashboard servers each running their own scheduler over it are the
obvious suspects. Re-run before believing either of them.

**`pkill -f "dist/server/index.js"` kills your own shell**, because the
pattern matches the very command line that contains it. Cost half an hour of
tool calls returning exit 1 with no output. Start each run on a fresh port
instead, or keep the PID.

**Suites that assert on notifications must pin the quiet hours.** The defaults
are 22:00–07:00, so a test written in the afternoon passes and the same test
fails at one in the morning. One did — and then `quiethours.mjs`, written to
prove the quiet-hours fix, walked into it too: quiet hours short-circuit
`notify()` before the no-device branch is reached, so it passed all afternoon
and failed at half past ten at night. Pin the window open (`00:00`–`00:00`)
for anything that is not itself about quiet hours.

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
