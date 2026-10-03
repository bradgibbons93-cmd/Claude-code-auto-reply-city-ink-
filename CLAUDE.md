# City Ink Tattoo Geelong — working notes

Read this before changing anything. It is the context a new session would
otherwise spend an afternoon rediscovering, and several entries are things
that were got wrong first and cost real customer messages.

## What this is

**Runnit** — a Messenger and Instagram front desk for tattoo studios, plus a
posting dashboard. It began as the private app for City Ink Tattoo in Geelong,
and City Ink is still the studio whose inbox this deployment runs. Brad
Gibbons owns it. Since 29 September it has real accounts, a studio per
location, onboarding and per-studio themes (see "Accounts, studios and the
login" below) — read that section before touching anything to do with who can
see what.

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

**Two of the three refusals it actually gets were never on the permanent
list**, so the back-off above was covering the rarest case and retrying the
two commonest ones for ever. Five days of live log, every couple of minutes:

    [Facebook] No name for 1634877124875070 — HTTP 403: (#230) User consent
               is required to access user profile
    [Facebook] No name for 1107893608468299 — HTTP 400: (#9010) No matching
               Instagram user

They are permanent in **different** ways, and collapsing them would be a
worse bug than the noise. `(#230)` is about the APP — the same answer for
everyone, so it joins the hour-long per-platform back-off. `(#9010)` is about
the PERSON: they deleted the account. That one is remembered per id in
`profileGone`, because filing it as an app-level refusal would stop the app
naming **everybody else** the moment one customer deletes their Instagram.
`namequiet.mjs` asserts exactly that difference — that a `(#9010)` leaves the
next person's lookup working, and a `(#230)` doesn't.

**The Live feed asked Meta for a permission it doesn't have, once an hour,
for ever.** `pages_read_engagement` is rejected (see App Review below), so
every hourly sync spent a Graph call earning the same refusal and printing it
next to the real faults. `blockedByReview()` recognises that specific class of
refusal and `feedWall` rests the sync for twelve hours, reporting "Waiting on
Meta" without touching Graph. Two things keep it honest: any successful sync
clears the wall immediately, so it resumes by itself the day approval lands
and needs nobody to notice; and **pressing Refresh ignores it**, because the
button is the instruction to try now — the same rule the Instagram import's
back-off already follows.

Fixing it turned up a third bare-`OAuthException` landmine, in the same shape
as the one under "OAuthException is Meta's error CLASS": a rejected permission
was being reported as an expired token. It now requires the token's own words
(`Session has expired`, `Error validating access token`, code 190) before it
says that. That is three files this mistake has been made in. Match the thing,
never the family.

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

**A message the studio has already decided about kept coming back round,
and the poll paid the model to write a draft it could never store.** Found in
the live log a minute after a deploy, on a real Instagram thread with a real
customer waiting:

    [Agent] Drafting for 1387883430218440 against "(sent a photo)" (...)
    [Agent] Bulk draft: 0 written, 0 failed

It says it is drafting and then writes nothing — every poll, for ever, and
"0 failed" reads as though there were simply nothing to do.

`customer_message_id` is unique. Once a draft has been approved or discarded
its row keeps that id, so a second draft for the same message is refused by
the index and `createPendingReply` returns false. But there is no *pending*
row left, so `getUnansweredConversations` went on listing the thread — and
`draftForUnanswered` composed a fresh reply, a real call to the model, before
finding out it had nowhere to put it.

This is the Instagram case specifically, and it is the ordinary one: an
approved Instagram reply is refused on send, so it leaves no message of ours
behind for the "did we answer after this draft" clause to see. Discard has to
stick too, or the card Brad just dismissed comes straight back.

The query now also skips a thread whose NEWEST customer message already
carries a decided draft. Bounded to the newest message on purpose: the
decision was about that message, never about the person — the moment she
writes again the clause stops matching and she is back on the board, which is
Brad's rule. `explainNotUnanswered()` names this case too, so the log tells it
apart from a stale draft.

`unanswered.mjs` had an assertion that only passed *because* of the loop — it
asserted the sentence printed at the bottom of the wasted pass. That is the
same shape as `sendfail.mjs` holding the wrong wording in place. It accepts
either sentence now and additionally asserts that no model call is made.

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

**The home screen listed threads the studio had already answered, and the
inbox opened on all of them.** Brad: *"some of the messages since it's been
going have been already replied to — only show us the most recent messages
that have not been replied to, and a history of the conversation if I scroll
up."*

The dashboard's inbox card took `conversations.slice(0, 5)` with no test at
all, under a heading that implied they were waiting. Brad answers people by
hand all day, so most of what the home screen showed him was work already
done — and a screen full of finished work reads as an app that is behind.
The Messages page had the right filter all along (`needs`) and simply
defaulted to `all`.

`isUnanswered()` lives in `lib/utils.ts` now and both screens ask it. That
matters more than either fix: the same question was already answered in two
places on the server (`getPendingReplies` versus `getUnansweredConversations`)
and a customer fell down the gap between them. One definition, or it happens
again.

Two things the fix must not break, and both are tested. **The history stays
one tap away** — All, and the thread's own scroll area. And **a name search
reaches past the open tab**: filtering the search by the tab as well would
have made every answered customer unfindable by name the moment the default
changed, which is a regression hiding inside a fix.

**Instagram is APPROVED.** Read from Meta's API on 18 September:
`instagram_manage_messages` and `instagram_basic` are both `is_live: true` at
**advanced** access, alongside `pages_messaging`, `pages_show_list` and
`business_management`. Instagram replies send. The month-long blocker is gone,
and the entries above about Instagram sending being refused are history, not
current state — keep them for the reasoning, don't act on them.

Still NOT granted: `pages_manage_posts` and `pages_read_engagement` (so the
Live feed page is broken and scheduled posts can't publish), `Human Agent`,
and the whole `instagram_business_*` branch, which is the wrong flow anyway.
The next submission is those first two, together, since posting depends on
`pages_read_engagement`.

**The agent sees two months of calendar, not a fortnight.** Brad: "I want the
agent to offer more dates, 2 months in advance it needs to see." A customer
asked about "next Saturday 19th" and the draft said it "isn't showing as free
for us yet" — which was never an answer about the 19th at all; the agent could
only see fourteen days out.

Raising the horizon alone would not have fixed it. `findFreeSlots` walks
forward and stops at the first few openings, so a named date beyond them is
still invisible. `findFreeDays()` is the other half: every day with something
open across the whole horizon, as one line in the prompt, so a customer naming
a date gets a real answer instead of "not showing".

**A date the customer NAMES is looked up on its own, up to six months out.**
Brad, 2 October, with Shae's card: *"Any availability for Saturday 12th
December please?"* and the draft *"December is a bit further out than what
we've got loaded in the books right now, so I'll check with Mim"*. Nothing
was wrong with the books — the two-month list ended in early December, so the
12th had never been looked at. *"it needs to look a couple months into the
calendar if requested by the customer"*.

Widening the everyday list was the wrong lever: it is every open day in the
window, it already pushed one thread's call into a timeout when it grew, and
March would still fall off the end. `datesNamedIn()` reads dates and months
out of the customer's last five messages (Australian order: 12/12 is the 12th
of December; always the next one coming), `namedDatesForPrompt()` looks each
up for every sitting length, and the prompt gets a section headed THE DATES
THIS CUSTOMER ASKED ABOUT with one plain line per date ("booked out", "short
sitting from 1pm, half day from 1pm, no full day", "closed on Sundays",
"more than six months out, so it hasn't been checked"). The prompt says never
to call a date "too far out" or "not loaded yet".

The reader is conservative on purpose — a missed date costs nothing (the
agent says it'll check, as before), an invented one puts a real day's
availability in front of someone who never asked. No "2.5" (a size), no
lower-case "may" (a verb), no month after "Hi" ("Hi June" is a person), no
"the 2nd one" (counting), and a bare "8/10" only counts if it reads like a
booking ("could I do 12/12", "is 19/12 free?") — "8/10 for sure" is a rating.
A span is only blanked out once it actually read as a date; blanking every
regex hit first ate "the 19th free" as a failed day-and-month and lost it.

The feed is now read once a minute, not five times a draft (`readFeed`):
three sitting lengths, the free-days list and the named dates each fetched
and parsed the whole Google Calendar. `tests/calendardates.mjs` (34 checks)
drives Shae's message through `draftForUnanswered` against a stand-in
calendar and model and reads the prompt that was actually sent.

**A price the studio corrected is remembered thirty deep; tone is remembered
five.** Brad, on a calf cover-up the agent quoted at $350 - $450: *"that quote
was a little low, the agent had it in for $350 - $450 but I adjusted to $550 -
$650"*. Under the plain five-most-recent window that lesson was gone within a
day of ordinary edits and the next similar piece got quoted low again.
`getPriceCorrections()` keeps only the rows where the dollar figures actually
changed — a reworded sentence around the same number teaches nothing — and the
prompt says these outrank the agent's own instinct.

Both correction readers now order by `created_at` **and** `id`. Brad works the
board in one sitting, so a dozen edits share a second, and on a bare timestamp
sort which five the model saw changed between identical calls. Same lesson as
`MAX(id)` further up: a tie needs a deterministic second key.

**Two daily follow-ups, and NEITHER sends.** Both put a draft on the board at
7am Geelong. Brad asked for both:

- **Cold enquiries** — we spoke last and heard nothing back for 3 to 42 days.
  The mirror image of `getUnansweredConversations`, and for a tattoo studio it
  is the commonest way a booking is lost: a quote sent into silence. Under
  three days is a person with a job, not a cold lead; past six weeks the
  moment has gone. Claimed in `follow_ups` so nobody is nudged twice, skipped
  entirely if a card is already on the board for them, and a `manual` pause is
  obeyed.
- **Aftercare** — three days after an appointment, ask how it healed. The
  calendar is the only record of who actually sat in the chair, so a past
  event is the signal and its title is the only name to match on. Anyone who
  can't be matched to a conversation is SKIPPED, not guessed at: "how's your
  tattoo?" to the wrong person is worse than nothing.

The review link is opt-in and never invented. With `google_review_url` unset
the agent thanks them and stops. Set, it asks **once**, only after a genuinely
happy reply, and never when the customer reports a problem — that case goes to
Brad, with no reassurance and no diagnosis.

These are drafts on purpose and it should stay that way. A follow-up is the
message most likely to read as automated when it lands wrong, and this app's
whole promise is that a person reads every word first.

**The review link had no box, and the back half had shipped alone.** Brad
found his link and sent it over, asking where it went. The honest answer was
nowhere: `google_review_url` had been read by `composeDraft`,
`draftColdFollowUps` and `draftAftercareMessages` since the follow-ups were
built, and nothing in the app could ever WRITE it. "Paste it into Settings"
would have sent him hunting for a field that did not exist — and this file
already lists that exact shape twice (the gallery picker offering a path
`posts.create` rejected; the 24MB photo route behind a 5MB global limit).

`config.reviewUrl` and `config.saveReviewUrl` exist now, with a card in
Settings between Calendar and What the agent knows. **An empty box clears it
on purpose**: unset is a real state the agent handles — it thanks them and
stops — so turning reviews off must not need a database edit.

**Neither `followups.mjs` nor the first version of `reviewurl.mjs` proved the
link reaches the MODEL.** Both asserted only that the setting round-tripped
through the database, which is the same bug one layer down: a link that saves
perfectly and is never put in the prompt is worth exactly as much as no box.
`reviewurl.mjs` now stands up a stand-in provider and drives
`draftForUnanswered`, then reads the body that was actually sent. Driving
`decide()` would have been easier and wrong — it is private, and calling it
directly tests the test's own call rather than the path a customer takes.

**The board showed the studio's own quote under "THEY SAID".** Brad, with a
screenshot, the day Instagram sending was approved: a card headed THEY SAID
carrying *"Hi Rebecca, Tattoo 1 - a memorial of your dog ... $300-$350 ...
Thank you so much 😊 xx"* — the studio's own message, presented as Rebecca's
words, on the one screen the studio trusts.

Three things had to be wrong at once and all three are fixed:

- **The card's lookup didn't check who said it.** It found the message by
  `customerMessageId` and rendered it, with no assertion that it came from the
  customer. Both halves require `senderType === "customer"` now. This is the
  line that makes the symptom impossible regardless of the data.
- **A message from our own account is ours, whatever `is_echo` says.**
  Messenger sets the flag; Instagram is not reliably the same, and Instagram
  sending had never once worked before that day — so this path had never run
  for a studio message. Anything slipping past was stored as the CUSTOMER
  having said it, and then the agent read the studio's own quote back as the
  customer's words. The webhook now compares the sender against
  `getPageIdentity()` and routes it to `handleEcho`.
- **`dropDraftsAnsweringOurselves()` only ever ran on a manual Import.** It
  has existed for a while and does exactly the right thing — delete any
  pending card whose `customer_message_id` is not a customer message — but
  nothing called it on a schedule, so a bad card sat there until somebody
  pressed a button. It runs at the top of the three-minute poll now.

**And it happened again, because the fix compared against the wrong id.**
Brad, with two screenshots, twelve days later: a card headed THEY SAID
carrying the studio's own deposit request, bank details and all, with a draft
reply written to it.

> Okay perfect, If you happy to book in, Could you please send $50 deposit for
> confirmation ... BSB - 063 097 ... Amount: $50

He typed that in Instagram himself. The second screenshot is the real thread,
where it is plainly the studio's own outgoing message.

The live log said it in two lines:

    21:38:37  last word: manual     <- a reply sent through the app: right
    23:35:51  last word: customer   <- the deposit message: wrong

and nowhere a `[Webhook] message from our own account` line, because the check
never matched. **`getPageIdentity()` asks the PAGE token, so it returns the
FACEBOOK PAGE id. The studio's Instagram account is a different number
entirely.** An Instagram sender could never equal it — not once, ever. So the
entry above was only ever true for Messenger, where the two happen to be the
same, and Instagram went on filing the studio's own words as the customer's.

The webhook now tests the sender against **`entry.id`**, which is the account
the delivery is ABOUT: the Page for `object=page`, the studio's own Instagram
account for `object=instagram`. It is right on both inboxes, costs no call to
Graph, and cannot drift out of step with a token. The Page identity stays as a
second opinion, never the only one. The recipient is checked too — a message
is ours only when we sent it AND somebody else received it — because if
`entry.id` were ever wrong the failure would be a real customer silently
filed as ours and never answered.

`theysaid.mjs` reproduces Brad's exact delivery and **fails on the old code
with the same two symptoms he photographed**: stored as `customer`, one draft
written. It asserts the Page id and the Instagram id are different, so a
fixture that cannot reproduce the bug fails loudly rather than passing.

**And a third time — the same mistake, one file over, in the IMPORT.** Brad,
26 September: *"it still says they said on some messages that is clearly from
ours, it still shows messages that have been replied to."* The webhook was
right by then. The three-minute import was not: `storeThread` picked the
customer as "the first participant who isn't the Page", and on Instagram the
studio's own account (`17841470171377490`) isn't the Page — so when Meta
listed the studio first, the STUDIO became the customer, and
`correctMessageSender` relabelled the whole thread the wrong way round, every
poll, for ever. The live log proved it without a database:

    10:30:20  [Agent] Human replied to 1109326724304489     <- echo, stored manual
    10:32:13  [Agent] Drafting for 1109326724304489 against "Hi Faith, I'll drawing up…"

— the only thing between those lines is the poll, and the only code that
changes `sender_type` is the import. It ran the other way too, which is worse:
Rebecca Laing's and Megan Renee Mose's real messages became "manual" within a
poll and their drafts were deleted as "answering ourselves". No echo, no log
line — they simply left the board. And any message the import stored for the
first time went into a thread keyed by the studio's own id.

The fix is to know every id the studio goes by, per inbox (`getOwnAccountIds`:
the Page, the Instagram account linked to it via `instagram_business_account`,
and every webhook `entry.id`, remembered in `app_settings.own_account_ids`),
and to **refuse rather than guess** (`pickCustomer`): a thread is only
imported when we know at least one of our ids on that inbox and exactly one
participant is not ours. A skipped thread costs nothing — the webhook already
has it. A wrong guess inverts a conversation. The import also moves messages
OUT of a studio-keyed thread into the right one (never between two customers'
threads), and `retireOwnAccountThreads` takes drafts off a studio-keyed thread
and removes it once empty. And an echo for a message already stored as the
customer's now relabels it — an echo is Meta saying in words that we sent it.

**Rule, now broken three times: never decide "is this us?" by comparing
against the Page id alone.** On Instagram it is always false. Use
`getOwnAccountIds()`.

**The fix only reached the thirty most recent threads.** Brad, the same night,
with a screenshot: Emily Failli's card, twelve days old, still headed THEY SAID
over the studio's own "Hello Emily … I'll see you then", with a cold follow-up
drafted on the strength of it. The poll imports thirty threads; anything older
that the old import had inverted was never looked at again.
`sweepOlderInstagramThreads()` (its own cron, every five minutes) walks every
Instagram conversation in the database through the fixed import, ten at a
time by row id, asking Meta for each by `user_id` so it never walks the edge.
Progress lives in `app_settings.ig_relabel_sweep`; it never moves past a batch
Instagram refused, steps over threads Meta says were deleted, waits until the
studio's Instagram id is known, and marks itself done when it runs out.

Two card fixes from the same screenshot. A follow-up's `customerMessageId` is
made up (`followup_cold_…`), so the card always fell back to "their newest
message" and headed it THEY SAID; it now says "Follow-up · last from them".
And a photo whose stored copy failed is only Meta's link, which dies in days;
the browser drew a broken "?" there. `MessagePhoto` shows a "Photo expired"
tile instead and doesn't offer to open it.

Stand-in note: point `INSTAGRAM_GRAPH_URL` at a different path on the stub
(`/ig/v21.0`) from `FACEBOOK_GRAPH_URL`, or the code concludes it's on
Instagram's own host, drops `platform=`, and the stub can't tell the inboxes
apart. `ownids.mjs` (43 assertions) fails 30 of them on the old code with
Brad's exact symptoms — Faith's card answering the studio, Rebecca gone,
"Everyone's been answered" on the home screen.

**`GROUP_CONCAT` truncation killed FIVE repair steps at every single boot,
and nobody noticed because the line reads like a warning.**

    [DB] Could not prepare schema: Row 411 was cut by GROUP_CONCAT()

The row number climbed by one a day as the studio's history grew. "The newest
message in each thread" was
`SUBSTRING_INDEX(GROUP_CONCAT(id ORDER BY created_at DESC, id DESC), ',', 1)`
in five places. `group_concat_max_len` is **1024 bytes** by default, so once a
thread had a couple of hundred messages the list was cut and MySQL raised.

The damage is in `ensureTables()`, where `liftStaleHandoffPauses()` runs FIRST.
It threw, so everything after it never ran, at any boot, ever:
`repairFailedDrafts`, `clearPlaceholderNames`, `repairConversationClocks` and
**`dropDraftsAnsweringOurselves`** — the last of which is precisely the thing
that deletes a card pointing at one of our own messages. The entry above about
it now running "at the top of the three-minute poll" was true; it also ran at
boot, and at boot it was dead. `[DB] Schema ready` never printed, which was the
tell nobody read.

All five sites are a correlated `ORDER BY created_at DESC, id DESC LIMIT 1`
now: nothing to overflow, same deterministic tie-break, and it reads as what it
is. `ensureIndexes()` adds `msg_conv_recent_idx (conversation_id, created_at,
id)` because the old index covered only `conversation_id`, and without the sort
columns MySQL reads and sorts every message in the thread on a query that runs
on every poll and every board load.

**This sandbox's MariaDB ships `group_concat_max_len` at 1MB; Railway's MySQL
uses the 1024 default.** The bug was therefore invisible to every local test
and fatal in production. `/etc/mysql/conf.d/zz-prodlike.cnf` pins it to 1024 so
the sandbox matches, and `groupconcat.mjs` asserts the setting is 1024 AND that
the old query really is cut at it. Without that pin the suite proves nothing —
the same trap as `prune.mjs` inventing ids that did not look real. MariaDB
raises warning 1260 and carries on where MySQL escalates to an error, so the
suite asserts the truncation, which is the mechanism, not the server's policy
about it.

**"OAuthException" is Meta's error CLASS, not a verdict on the token.** The
boot log, four seconds apart:

    [Facebook] Page token belongs to app 4457207527757824 ("city. nk autoi")
    [Facebook] Name backfill: 0/5 — The saved Page token has expired.

The token was fine. `explainProfileFailure()` matched a bare `OAuthException`,
which is on very nearly every Graph failure — including `(#230) User consent is
required` and `(#9010) No matching Instagram user`, the two ordinary refusals
the name backfill actually gets. Acting on that sentence means an evening
regenerating a token that was never the problem. **This is the third time this
project has been sent to fix a setting that was already right** (the model
name, the Graph permission, now the token), and every time the cause was
matching a word that belongs to a family rather than the thing itself. An
expired token says "Session has expired", "Error validating access token", or
carries code 190. Nothing else counts. Both refusals now get their own honest
sentence, and `profilewhy.mjs` holds the line with Brad's verbatim error
bodies.

**A timed-out Instagram thread was abandoned, not asked again smaller.** Found
while chasing the repair for the above: the sender correction only happens on
a thread that opens, and the log was full of
`wouldn't open — timeout of 20000ms exceeded`. Only an explicit "that was too
much" earned a smaller ask; a timeout broke out of the loop. A timeout means
the same thing, so it now earns the same retry, on a shortening clock
(20s/10, 12s/3, 8s/1) so three attempts still fit inside the caller's
100-second deadline.

**The home screen opens with "is it alive" and "where is everything".**
Brad sent a mockup he liked — gold on black, somebody else's brand — and the
half worth taking was the layout, not the palette. Two things came from it:

- `AgentStatusCard` — one card at the top saying whether the agent is
  actually drafting, reading the same `lastError` the failed-draft card does,
  so the two can never disagree. It exists because the failure mode of this
  whole product is **silence**: every time the app has quietly stopped — a
  spent account, an expired token, a key on the wrong workspace — the
  dashboard went on looking completely normal. It wraps the provider's own
  sentence rather than truncating it; "the agent can't write anythi…" is the
  same dead end as no message at all.
- `StudioTiles` — eight tiles, everything one tap from home. Brad works on a
  phone, where the sidebar lives behind a hamburger, so a section he doesn't
  open weekly may as well not exist.

The palette stayed the studio's own. Coffee brown and silver are on the sheet
he sent and on the sign above the door; the mockup's gold would have been a
third colour the studio doesn't own, which this file already has a rule
about.

**A photo opened with no way back out, and on the home screen that meant
force-quitting.** Brad: *"when I click on a photo either the ones uploaded by
artists or the customer pictures, there is no back button and I have to cancel
the app."*

Every photo was an `<a target="_blank">`. In a browser that opens a tab you
close. Installed on the **home screen** — which is where he works, and which
Apple requires before a push can arrive at all — the app runs standalone with
no address bar, no tabs and no back button, so the picture covered everything
with no exit. Force-quitting was genuinely the only way out, and it dropped
him back on the dashboard rather than the thread he was reading.

`PhotoViewer` opens it inside the app with four ways out: the close button,
the backdrop, Escape, and the phone's own back gesture. Three of those are
obvious; the fourth is the one he'd actually reach for after being trapped.

Three things about it are load-bearing, and I got two of them wrong first:

- **It renders through a portal into `<body>`.** In place, the close button
  came out UNDERNEATH the header — the one control that had to work.
  `position: fixed` resolves against the nearest ancestor carrying a
  transform, not the viewport, and these photos sit inside cards with
  `animate-fade-up`, which is a transform. So `fixed inset-0 z-50` was pinned
  inside a card and trapped below a `z-20` header.
- **The back-gesture handling must not double-pop.** The first version called
  `history.back()` in cleanup unconditionally, so a real back press consumed a
  second entry and left the app entirely — worse than the bug being fixed. It
  tracks whether popstate already did it.
- **The effect runs on mount/unmount only.** `onClose` is an inline arrow at
  every call site, so a fresh identity each render; with it in the deps this
  pushed a history entry per render until back did nothing at all. The
  callback lives in a ref.

**Playwright's `isVisible()` called that buried close button visible.** Being
covered by another element is not being hidden, so the assertion passed while
the control was unreachable. The screenshot is what caught it. Anything that
must be TAPPABLE gets `document.elementFromPoint` at its centre, not
`isVisible()`.

**The thread had no scroll area of its own, so "up" left the conversation.**
Brad, same message: *"I can't scroll up in the messages to see previous."*

The messages were just more page. Opening a thread left the view wherever it
already was — thousands of pixels up, on the dashboard counters and the draft
board — and scrolling up inside a conversation walked back out of it instead
of reaching older messages. "Load older messages" was real, worked, and sat at
the top of that buried block where he could never see it. Measured at 430px:
6722px of page, a 932px window, and the thread far below the fold.

It behaves like a messaging app now: opening a thread scrolls it into view and
lands on the newest message, the list scrolls itself (`max-h-[60vh]`,
`overscroll-contain`) so up always means further back, and loading older
messages restores the distance from the bottom so the view doesn't lurch.

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

**The HTTP timeout has to be in proportion to `max_tokens`, and for months it
wasn't.** A flat 20 seconds, while the budget is 4000 and the retry doubles it
to 8000. A model that reasons before it answers cannot write eight thousand
tokens in twenty seconds, so the retry that exists to RESCUE a hard draft
could never once have finished — the doubling was pure cost.

Found on a live thread that timed out on **every single poll** while every
other thread drafted fine, so it read as "the provider is slow" and was really
the client hanging up on it. One customer, permanently on the board with an
empty card. It surfaced the day the prompt grew (two months of free days, plus
thirty price corrections), which pushed that thread's call over a line it had
always been close to.

Roughly a second per hundred tokens now, floored at the old 20s so nothing
small gets slower and capped at 90s so a wedged call can't hold a poll open.

**And `draftForUnanswered` stops STARTING new drafts after two minutes.** The
poll runs every three, a call can now take ninety seconds, and ten in a row
would run one poll into the next. Overlapping polls is a failure mode this
project has already had once, on Instagram's import, and it is miserable to
diagnose because nothing errors — the work just doubles. Whatever is left is
not lost: the thread is still unanswered, which is the whole basis of the
query, so the next pass takes it.

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

**The Messages page reads like Meta's inbox, on purpose.** Brad, 29 September,
with a screen recording of Meta Business Suite: *"I WANT IT BASICALLY TO LOOK
LIKE THE SAME ORDER AND EVERYTHING AS METAS INBOX! But when I click into a
message, it comes up with the auto replied message and a few different
options."* He works the two side by side all day. So: one list, newest first,
split into **Needs a reply** (they wrote last, inside Meta's seven days) and
**Replied** (we spoke last, or it's past seven days), each row a picture with
the inbox badge, the name, Meta's preview line ("LIV sent 2 photos.") and a
short clock ("7h"). Tapping opens the thread with the draft underneath and
every other version as a full card — chips with the text in a hover title were
unreadable on a phone. The 67-card grid above the list is gone; a draft lives
inside its conversation. `awaitsStudio()` in `lib/utils.ts` is the one test for
the top section, and `isUnanswered()` is built on it, so the home screen and
the inbox cannot disagree.

**A draft for someone who last wrote over seven days ago is off the board.**
Brad, over a card for a thread with a months-old deposit receipt in it asking
her what size she wanted: *"Always remove messages that have been replied to
already."* Those threads were answered by hand in the Instagram app, where no
echo reaches us. There is no way to prove that after the fact — but Meta's
rule is certain: past seven days the app may not reply at all. So
`getPendingReplies` drops them (follow-ups excepted, they're for quiet threads
by design) and sorts by when the customer last wrote, newest first. The rows
stay `pending`, so nothing is deleted and the poll still reads "a draft is
already waiting" rather than drafting them again. `REPLY_WINDOW_DAYS` is 7 in
both `db.ts` and `lib/utils.ts`.

**The model SEES the customer's photos.** It never had: `invokeLLM` sent text
only, so a customer who sent two photos showing exactly the size got *"If you
can give me a rough size (cm) for both pieces I can work out an accurate
price"* — the only thing a model reading "(sent a photo)" could say. Brad:
*"base it roughly from what they send and give a rough estimate price"*.
`composeDraft` now loads up to four of the customer's kept photos
(`/api/attachments/…` only — Meta's own links expire) and puts them on their
latest message; the prompt's READING THEIR PHOTOS section says to judge size
from them and quote straight away. The size is the model's read; every dollar
still comes only from the studio facts. If a provider refuses an image,
`invokeLLM` asks once more without the pictures — a photo is help, never a
condition of getting a draft. `tests/inboxmeta.mjs` asserts on the request
body that actually reached the provider.

**No price until we know the size AND where on the body.** Brad, 2 October,
with Nathan's thread on screen: a flat drawing of two rings round a ghost,
"No love heart on the top though", then "I was thinking next weekend if
you're free" — and the draft quoted "$250-300". Nobody had said how big or
where, and he hadn't asked what it cost. *"make sure we always ask for size
and area, unless they send a photo of it already drawn on or edited onto
their body and you can estimate"*.

The entry above is still right for its case — two photos of the design ON
her arm show the size, so quote. What was wrong was the line telling the
model to guess a range even from a flat design. Now: size and placement must
both be known, from the customer's words or a photo of the design on their
own body; a flat drawing, screenshot, internet/AI design or someone else's
tattoo doesn't count; and no price is brought up unasked. The model returns
`quote: {gives_price, size, placement}`, and `unsupportedQuote()` checks it
against the text itself (`quotesAPrice()` — a range or a hedged "around $X";
a flat "$50 deposit" or "our minimum is $150" is a studio fact, not a quote).
A draft that prices an unsized piece is sent back once with the reason, and
if the model does it again the card gets `ASK_SIZE_AND_PLACEMENT` and only
the alternatives with no price. A guessed number never reaches the board.
`inboxmeta.mjs` reproduces Nathan's thread and a model that won't stop.

**A reply in plain words gets one more ask, not an empty card.** Live, 1
October, 5:44–5:59pm: one customer's enquiry came back as plain prose six
polls running — `[LLM] Model replied without JSON. Raw: Hey Lilly 😊 got it,
this one running along the forearm...` — a perfectly good draft, binned
because it wasn't wrapped in JSON, and the customer sat on the board with an
empty box. `invokeLLMJson` now shows the model what it wrote and asks once
for the JSON; only a second miss is a failure. `inboxmeta.mjs` section 8.

**"We'll check with Mim" emails Mim a picture of the conversation.** Brad,
29 September: *"If anything is written that we will check with Mim (please
fix spelling in the app) then take a screenshot and send Mim an email
checking."* Mim is the artist. `checkWith.ts` holds all of it:

- **The prompt names her.** Every deferral that used to say "check with the
  team" says "check with Mim" when a name is saved, and a CHECKING WITH
  section says when to use it. `fixNameSpelling()` corrects "mim"/"MIM" in the
  draft and its alternatives — whole word only, so "Mimi" and "mimic" survive.
  The sensitive-message holding line still says "someone from the team" on
  purpose: that one is for Brad.
- **Sent, not drafted.** The email goes when a reply that says so actually
  leaves: `approveDraft` and `handleEcho` (Brad copies drafts into Instagram by
  hand all day, and those come back as echoes). A draft he rewrites or
  discards promised nobody anything. `mentionsCheckWith()` is deliberately
  narrow — "Mim can do 3pm" is an answer, not a deferral. The client has a copy
  in `lib/utils.ts` for the line on the draft card; keep them in step.
- **Once per promise.** Instagram echoes a reply the app sent under a
  different id from `draft_N_sent`, so `check_alerts` is keyed on thread +
  words + day, not message id.
- **Railway blocks SMTP below the Pro plan** (their docs, in as many words),
  so Gmail's SMTP is out. The mail goes through an Apps Script web app in
  Brad's own Google account, over HTTPS: it sends as him, so Mim sees who it's
  from and her reply lands with him. Settings → Inbox → "Checking with Mim"
  shows the script (with a key the app generates once — regenerating it would
  silently break the script) and takes the `/exec` address. Google answers a
  web-app POST with a 302; fetch follows it. An HTML answer is Google's sign-in
  page, which means the deployment's "Who has access" isn't Anyone — the error
  says exactly that.
- **The picture is drawn, not screenshotted.** `snapshot.ts`: satori lays out
  the bubbles, sharp paints the PNG. The font (`@fontsource/inter`) and the
  emoji (`@twemoji/svg`) come from npm, because the Railway container has no
  fonts and anything that asks the system for one draws blank boxes.
- With email not connected nothing throws: the miss is recorded in
  `check_alerts`, Settings lists it, and Brad's phone gets one buzz a day.
  "Send to Mim" in a thread uses the phone's share sheet until then.
- `CHECK_WITH_NAME` / `CHECK_WITH_EMAIL` / `MAIL_RELAY_URL` are defaults for
  the three boxes; a saved empty name turns the whole thing off.

`mimcheck.mjs` (49) and `mimbrowser.mjs` (15, phone-sized browser) prove it.

## Artist photos into posts

Brad, 2 October: *"when an artist uploads a photo into that upload section,
I want that to trigger and send to Claude or Canva to a template I have set
up ... adds the tattoo studio logo over their images and retouches the
colour. If it could then put it into the scheduler with a simple caption
same as all our other posts, that would be amazing."* All of it is
`server/autopost.ts`.

- **Not Canva.** Filling a Canva template from outside Canva (Connect's
  autofill) is Enterprise-only, and the server has no Canva session anyway.
  His template ("finished tattoo template", or near it) wasn't in the Canva
  account connected to Claude either. The template's whole job — logo in a
  corner, a touch more colour — is done with sharp in `brandPhoto()`. The
  corner, size, touch-up and posting time are chosen in Gallery → "Photos
  into posts", against a live preview of the studio's latest photo
  (`/api/post-look/preview`). The logo is the studio's own, from Settings.
- **A post nobody approved cannot go out.** It is inserted as status
  `review`, and only `scheduled` is ever published (`getDuePosts`). Posts →
  "Waiting for your OK": edit the caption or time, Approve, Copy caption,
  Save photo, Remove. Don't use `draft` for this — the publisher uses
  `draft` as its in-flight claim. Railway's table predates `review`, so
  `ensureEnums()` in migrate.ts MODIFYs the column; ADD COLUMN can't, and a
  missing enum value would fail every insert there while passing locally.
- **One post per photo, ever.** The upload route starts it (not awaited),
  a five-minute sweep catches what it missed, and both go through `claim()`
  — one conditional UPDATE on `artist_uploads.auto_post_state`. A re-sent
  photo is the same row (content-addressed) and is already `done`. A claim
  stuck in `working` for ten minutes (a crash mid-run) is taken again.
  Removing a post hands the photo back to the gallery as unused but leaves
  it `done`, so it is never made into a post again by itself.
- **The back catalogue is never swept.** `auto_post.since` is set the first
  time the feature runs and again whenever it's switched back on; the sweep
  only looks at uploads after it.
- **The caption model SEES the photo** and is shown the studio's own recent
  scheduled/published captions as the style ("same as all our other
  posts") — never a `review` one, or it would end up copying itself. It
  credits the artist by name and must not name or describe the client. If
  the model is down it falls back to the bulk scheduler's stock lines plus
  "Tattooed by X." A post with no logo (none set, or one that won't decode)
  still gets made.
- **Its own phone alert**, `onPost`, on by default — the drafts alert is
  off by default and the upload page is anonymous and silent, so nothing
  else would ever say a post is waiting.
- **Facebook posting still needs `pages_manage_posts` from Meta.** Until
  then an approved post will fail at its time like any other; Save square,
  Save story and Copy caption are on the card for posting by hand.
- **Two pictures per post, in fixed frames** (Brad, same day: *"make it into
  a square version and also a 1080 x 1920 for insta stories"*). The 1080
  square is the post (`image_url`); the 1080x1920 story is saved beside it
  (`story_url`) to be posted by hand — the app can't publish a story. A photo
  close to the frame's shape (3:4 for the square, about 9:16 for a story)
  FILLS it, cropped by sharp's attention strategy, which keeps the busy
  detailed part — the tattoo. Anything else is shown WHOLE over a blurred,
  darkened copy of itself, because cropping a 3:4 photo to 9:16 cuts away
  half the piece. A story's logo sits 230px clear of Instagram's top bar and
  reply box. `housekeeping.ts` reads `story_url` too: nothing else points at
  a story, so without it the 2am clear-out would delete every one.
- **The logo on posts can differ from the app's logo.** Brad's "City Ink
  official logo white" PNG is right on a photo and invisible on the app's
  light themes, where logos sit on `bg-card`. So Gallery → "Logo on posts"
  takes its own upload (brand asset kind `postlogo`, kept at 1600px — the
  app logo is shrunk to 640), stored as `auto_post.logoAssetId`, with "Use
  the studio logo instead" to go back. Ownership is checked on save, as for
  every brand asset. The cleaned-up file was sent to Brad in the chat to
  upload there himself (the app has no way to set it on his behalf).
- **The logo's shadow was solid black, whatever the code said.** Brad, same
  day: *"the shadow on the logo is way to dark"*. The code faded the logo's
  alpha to 60% with `extractChannel(3).linear(0.6, 0)` in ONE pipeline —
  but sharp runs `linear()` before `extractChannel()` whatever order they
  are written in, and `linear()` leaves alpha alone, so the fade never
  happened (255 in, 255 out; `autopost.mjs` measured the old one darkening
  the skin under the logo by 34%). Cut the channel to a buffer, THEN fade
  it. Same family as the `stats()` trap below: **sharp's pipeline has a
  fixed order of its own; anything order-sensitive goes in two pipelines.**
  There's a None / Soft / Strong choice now (`look.shadow`, default Soft),
  in the Gallery card.
- **The photo editor** (`components/PhotoEditor.tsx`). Brad, 2 October,
  first *"I want to be able to drag to recenter the picture"*, then, on the
  photo in Schedule a post: *"a little pop up tab or text either under or on
  the photo as a button ... edit or add logo and post then it will come up on
  that picture and can adjust the saturation contrast and brightness and
  adjust the position and be able to crop and zoom"*. One editor, two doors:
  **Edit & add logo** under the photo on a post made by hand
  (`PostImagePicker`, Square or Portrait 4:5 → `posts.editPhoto`), and
  **Edit photo & logo** on a waiting post (`ReviewPosts`, Square and Story →
  `posts.reframe`). Drag to move, pinch or the Zoom slider to crop in,
  Brightness / Contrast / Saturation, and the logo on/off, spot, size and
  shadow for that photo only.
  - **What's on screen is what gets drawn.** The ORIGINAL photo is laid out
    with the server's own numbers: size as a multiple of "the whole photo
    just fits" (`zoom`, 1 = whole photo over the blur, `coverZoom` = fills)
    and position as CSS object-position (0–1, the share of the spare room
    before the photo). `brandPhoto(…, position, adjust)` cuts out only the
    visible part before scaling, so zooming in on a 2048px photo never
    builds a picture several times the frame. Colour is a CSS filter in the
    order the server applies it. The logo guide is the server's own drawing
    (`/api/post-look/overlay`, which takes the editor's choices).
  - **Always from the original, never from an edit** — that would crop a
    crop and paint a logo over the logo. The picker keeps the original's
    address and the last settings, so Edit again opens where it was left. A
    link to another site can't be edited (the server doesn't fetch
    strangers' URLs) and says so.
  - **A waiting post keeps its own choices.** `scheduled_posts.framing`
    (spot + zoom per picture, and whether placed by hand) and `photo_style`
    (adjust + logo choice). Redraws for a studio look change keep both; only
    pictures actually moved are sent, so an untouched one stays automatic.
    Back to automatic sends nulls for all three. Only `review` posts can be
    edited: approved is approved. Sharp's own crop comes back from its
    `cropOffsetLeft/Top`, so the editor starts where the photo really is.
  - **A full-screen sheet in a portal**, like `PhotoViewer` and for the same
    reason (`fixed` inside a transformed card lands under the header and the
    bottom menu — the New post box is one), with the same four ways out. The
    photo is pinned at the top and only the controls scroll: the first
    version scrolled the photo away exactly when the logo options were in
    use. `touch-none` on the frame stops a finger drag scrolling the sheet.
  - `tests/photoeditor.mjs` drives both doors on a 390px phone (mouse drag,
    a real CDP touch drag, a two-finger pinch) and reads the server's JPEGs
    back; `autopost.mjs` checks zoom, colour, the per-photo logo and that
    redraws keep them.
- **Waiting posts are redrawn when the look changes.** Change the shadow in
  the Gallery, go to Posts, still see the dark one: the obvious conclusion
  is that the change didn't work. `scheduled_posts.look_key` hashes the look,
  the logo and `RENDER_VERSION`; a `review` post with a different key is
  redrawn (4s after a save, in the five-minute sweep, and at boot), keeping
  any hand-placed spot. Bump `RENDER_VERSION` when the drawing changes —
  that is how the posts already waiting got the soft shadow. Every redraw
  write is conditional on the row being as it was read (`framing <=>`,
  `look_key <=>`, still `review`), so a drag or an approve mid-redraw wins.
- **On or off is decided when the photo ARRIVES.** It used to be read only
  when the photo's turn in the queue came round, so a photo sent while the
  feature was off, waiting behind a redraw, became a post anyway once it was
  switched back on. The full test run caught it (the "off" check had passed
  seconds earlier); `autopost.mjs` asks again at the very end of the suite.

**Bulk-scheduled posts were landing at 9pm.** `planDates` used
`setHours()`, which is the server's clock, and Railway is UTC with no `TZ`
set — so "11:00" was 11am in London, and a start date picked early on a
Geelong morning was filed under the day before. Days and times are now on
the studio's clock (`studioTime` / `studioDateParts` from calendar.ts), and
`dayKey()` is the studio's calendar date. `autopost.mjs` pins 11am Geelong
to 01:00 UTC, across the daylight-saving change.

`tests/autopost.mjs` (130 checks) drives it end to end against the real
server. Trap found writing it: sharp's `stats()` reads the WHOLE image
whatever `extract()` says, so measuring a patch in one pipeline averaged in
the logo and looked like a colour shift. Cut the patch to a buffer first.

## Accounts, studios and the login

Built 29 September from Brad's "Final product pass" brief: a landing page,
sign up, onboarding, a dashboard that is *theirs*, settings that control the
product, several studios per login, and "returning users go straight back into
their workspace".

**The security model is one rule, and everything else hangs off it.** The
inbox, drafts, agent, posts and every setting that existed before accounts
belong to the studio recorded as `data_studio_id` in `app_settings` — the one
this deployment's Meta connection belongs to. They are readable only by a
member of that studio, while it is the studio they have open
(`viewer.canReadData`). In code that is `studioProcedure` in `trpc.ts` (every
old procedure; the old `publicProcedure` name is gone on purpose) and
`requireStudio` / `requireStudioOrSignedLink` in `auth.ts` for the Express
routes. A stranger who signs up gets their own studio and cannot read a single
City Ink customer, photo or setting, by any screen or by calling the API by
hand. `tests/accounts.mjs` is mostly a stranger trying — run it after touching
any of this.

- `accounts.ts` — users (the template's unused `users` table, extended), scrypt
  passwords, sessions. The cookie `runnit_session` carries a random token; the
  `sessions` table holds only its SHA-256. 30 days, sliding. Changing the
  password signs out every other session. Wrong-password lockout is per email
  (10 / 15 min) and much looser per network address (40), because a whole
  studio shares one wifi.
- `studios.ts` — studios, `studio_members` (owner today; "staff" is the room
  left for a team later), branding images in `brand_assets` (same MySQL-blob
  storage and `images.ts` shrinking as everything else, but its own table
  because anyone may see a logo and nobody may see a customer's photo; served
  open at `/api/brand/:id` under random 160-bit ids), the claim flow, and
  `studioIdentity()` — the studio name, town and owner's first name the AI
  prompts, phone alerts and default captions now use instead of "City Ink" and
  "Brad" written into the code.
- **City Ink becomes a studio on first boot.** `ensureStudios()` sees an inbox
  and no studios, makes one from the Page's name with the Coffee & Silver
  theme, and marks it the data studio — with no owner. The owner links it with
  the **claim code**: `STUDIO_CLAIM_CODE` (or the old `DASHBOARD_PASSWORD`).
  With neither set, nobody can claim it and the boot log says so every time.
  On a brand-new database the first studio anyone creates takes the Meta
  connection instead.
- **Public sign-up is OFF unless `PUBLIC_SIGNUP=open`.** City Ink's Meta app
  was approved as an internal tool for one studio, not sold to others (see Meta
  App Review) — a public "Create your studio" on this address would make that
  untrue. Closed, the only way to make an account is with the claim code, which
  links the studio in the same step, and then the door shuts.
  `tests/inviteonly.mjs` holds that line. A Runnit deployment with its own Meta
  app sets `PUBLIC_SIGNUP=open` and gets the landing page at `/`.
- **Other studios have everything except an inbox.** Their own name, branding,
  theme, details and settings are real and saved; the data pages show
  `ConnectState` ("this studio's inbox isn't connected yet") rather than
  anything pretend. Per-studio Meta connections need a Runnit-owned Meta app and
  a per-studio `facebook_config` — that is the next piece of work, not this one.
- **Onboarding** (`/welcome`, `pages/onboarding/`) saves at every step to the
  real records, and `users.onboarding_step` remembers where it got to, so a
  refresh or a closed tab resumes. `onboarding_completed_at` ends it for good;
  nothing ever sends a finished account back through it.
- **Routing is decided in one place** (`App.tsx`): signed out → landing (open
  sign-up) or log in; signed in and not set up → `/welcome`; set up →
  workspace, and `/login` `/signup` `/welcome` bounce to `?next=` or home. Pages
  must NOT also navigate after logging in or finishing setup — they raced this
  rule, and for a frame the old session won and sent people to the wrong page.
  Logging out is a full page load onto `/login` for the same reason.

**Themes** live in `lib/themes.ts`: seven looks, each with a light and dark
palette, an optional accent, and its own display font. They are just the CSS
variables `index.css` already defined, so `applyLook()` sets them on `<html>`
for the whole app and `previewStyle()` sets them on one box — which is how
every card in the theme picker is the studio's actual dashboard in that look
(`DashboardPreview`). The look is stored on the studio, so it follows the
account to every device; `index.html` paints the cached look before React loads
so a refresh doesn't flash the default. City Ink's is `coffee`, the palette
below. Runnit's own screens (sign up, log in, onboarding) wear `noir` via
`RunnitShell`; the landing page (`pages/Landing.tsx`, `components/landing/`)
paints its own black and gold and ignores the theme entirely.

**`DASHBOARD_PASSWORD` was never set on Railway.** The shared-password door
this section used to describe was switched off during Meta's review and never
switched back on, so until accounts ship the live dashboard is readable by
anyone with the address. Shipping this closes that.

Never guarded: Meta's webhook, `POST /api/uploads` and the `/upload` page (the
artists reach it by QR code on the studio wall; it now shows the studio's name
and logo from the open `/api/studio-brand`), `/api/brand/:id`, `/health`.

## The Home screen

Built 29 September from the design Brad picked on the canvas ("Build it").
`pages/Home.tsx` replaced the old stats-and-lists dashboard. His brief, in
order: **auto replies first, then scheduling, then posting**; simple, animated,
a hint of tattoo. Phones also got a bottom menu (Home, Messages, Bookings,
Posts, More) in `App.tsx`; the desktop sidebar is unchanged.

- **The reply deck (`components/home/ReplyDeck.tsx`) is an approval screen.**
  Swipe right = Approve & send, through the same `pendingReplies.approve` as
  the inbox. Swipe left, or a tap, opens the conversation. Because a swipe can
  be an accident, **nothing goes to Meta for five seconds**: the card leaves,
  a toast offers Undo, and only then does the approve call run.
  `components/home/sendQueue.ts` holds that window at module level so leaving
  the page doesn't silently cancel a send the studio saw go. Don't shorten it
  to zero and don't add an auto-advance — the canvas mock-up auto-swiped as an
  animation; in the app that would be sending replies nobody approved.
- **Some drafts can't be sent blind.** Something personal (`isSensitive`), a
  draft the AI never finished, one Meta already refused (`sendError`), or a
  message over a fortnight old: the button reads "Open chat" and a right swipe
  opens the thread instead. Same rules the inbox card warns about in words.
- **The "AI replies live" pill is AgentStatusCard's honesty, kept.** Unhealthy,
  it turns red and the provider's own sentence appears across the top. The old
  card is gone; its rule isn't.
- People waiting with no draft (failed draft, taken over, imported) can't be
  on the deck, so the page counts them under it rather than lose them.
- **Today's timeline reads `calendar.today`**, which returns minutes past
  midnight on the studio's clock (`STUDIO_TIMEZONE`), so the browser never does
  timezone maths. The tattoo machine sits at "now" and only buzzes while
  someone is in the chair.
- **The 3D icons and the flash sheet in `public/home/` were generated with
  Higgsfield (gpt_image_2_5, transparent PNG → WebP), on Brad's credits.** Don't
  regenerate them casually. The flash sheet is used as a CSS mask
  (`.home-flash`), so it draws in whatever accent the studio's theme has.
- **How the 3D illustrations are drawn is the studio's choice** (`studios.art`,
  Settings → Appearance → Illustrations). Brad, 2 October: *"I want an option
  to remove the little png black images we added. Or even better, they should
  change colour along with the colour of the theme or just black or white."*
  `theme` (the default) greys the picture and lays the theme's
  `--c-accent-strong` over it in `color` blend, masked to the picture's own
  shape, so the shading survives; `gold` is as drawn; `mono` black and white;
  `off` hides them and the flash sheet. Every one of them goes through
  `components/home/Art.tsx` — a bare `<img src="/home/…">` will ignore the
  setting. The mask URL is made absolute on purpose: a `url()` inside a custom
  property resolves against the stylesheet that uses it, so the test drive's
  relative paths masked the tint with nothing.
- **Black & Gold Ink** (`ink` in `lib/themes.ts`, and in `THEMES` in
  `server/studios.ts`) is the look the Home was drawn in: Oswald over
  Instrument Sans, no serif (Brad asked for the Bodoni headings to go). The
  Home is built on the theme variables, so every other look works too.
- `DashboardPreview` (theme picker, onboarding) draws the Home screen in
  miniature. Change it with the Home, or "every card is your actual
  dashboard" stops being true.
- **The classic dashboard is still in the app, on purpose.** Brad, before it
  went live: "make it easy to undo back to the version it is now". The studio
  record has `home_layout` ("classic" or null for the new Home); "Prefer the old
  dashboard? Switch back" under the Home, "Try the new Home" on top of the
  classic one, and Settings → Appearance → Home screen all flip it, saved on
  the studio so every device agrees. Classic also brings back the app as it
  was around it (no bottom menu, the Live pill on phones). Don't delete
  `pages/Dashboard.tsx` while that switch exists.
- **The test drive** (`npm run build:demo` → `dist-demo/`) is the real app on
  pretend data, for trying screens before they go live — it was published as
  an artifact for Brad to use on his phone. `src/client/demo/mock.ts` replaces
  the network (there is none: nothing can reach Meta or the inbox);
  `fixtures.json` is recorded from the real server by
  `scripts/demo-fixtures.mjs` with invented customers, and every timestamp is
  moved to "now" when the page opens. `vite.demo.config.ts` makes the
  site-root picture paths relative and turns log-out into "start over".
  Re-run the fixtures script after changing what a screen asks the server for.
- **A test drive dressed as another studio, for a pitch** (`src/client/demo/brands.ts`,
  `npm run build:demo:allink` → `dist-demo-allink/`). Brad, 2 October: *"Make a
  version test demo pitch for all ink tattoo Wollongong"*. The brand is laid over
  the recorded fixtures: name, logo, theme + accent, the owner's name, drafts and
  past replies in their voice, and their own PUBLISHED policies only (website,
  Timely booking page) — anything they don't publish (deposit amount, prices,
  other artists) is left out, not guessed. Customers stay pretend: never a real
  studio's real customers in anybody's pitch. "Send a test DM" in the demo bar
  drops a scripted enquiry in, and its draft appears a couple of seconds later —
  the whole product in ten seconds. `DEMO_TITLE` sets the page's own `<title>`,
  which is what names a published artifact.
  Brands so far: `allink` (All Ink, Wollongong) and `cic` (Canggu Ink Club,
  Bali — `npm run build:demo:cic`, 3 October). A brand can set `timeZone`
  (cic is `Asia/Makassar`) so the demo's clock and booking times read local.
  The cic brand names no owner or artists (they don't publish one) and its
  drafts quote only their published prices: the 1M IDR minimum and the
  up-to-5×5cm table from their FAQ.
- `tests/home.mjs` drives it on a phone-sized browser: swipe → Undo offered →
  nothing sent for five seconds → exactly one send with the draft's words;
  Undo → nothing sent; left swipe → the thread; a personal message → opens the
  chat, sends nothing; tiles, timeline, bottom menu, laptop layout.

## Meta App Review

**What is actually broken: Instagram replies, and nothing else.** Messenger
sends reach real customers today — see the entry above. So the entire value
of App Review, for this studio, is one permission:
`instagram_manage_messages`. Everything below is the state of the submission
that is meant to grant it.

**Read from Meta's own API on 8 September, through the Meta Social
Technologies MCP. This replaces every guess above it, and two of my own
earlier readings of it.**

**A submission asking for `instagram_manage_messages` is now PENDING** —
the first one that has ever asked for the permission the live errors name:

    submission_status: PENDING     submission_id 4514855335326376
    submitted 8 September 2026, 06:54 AEST
    requested: instagram_manage_messages, instagram_basic

**What the 6 September review actually decided.** Approved and live:
`pages_messaging` at **advanced** access, `pages_show_list` and
`business_management` at standard — all three re-confirmed by a renewal on
8 September. Messenger is settled; nothing about Instagram threatens it.
Rejected: `instagram_business_basic`, `instagram_business_manage_messages`,
`pages_read_engagement`, `Human Agent`.

Meta's rejection reason, in their words, for all four:

> **Screencast Not Aligned with Use Case Details** (Developer Policy 1.6)
> "the submitted screencast fails to demonstrate the end-to-end experience of
> the use case described in the submission notes"

and their list of what a passing screencast must contain: the complete Meta
login flow; a user granting app access; the end-to-end experience; **captions
and tool-tips explaining what buttons do**; and — the important one for this
app — *"if your app is a server-to-server app … indicate it in your next
submission so that we're aware that frontend Meta login authentication flow is
not visible."*

**Two permissions in that submission were the wrong ones all along.**
`instagram_business_basic` and `instagram_business_manage_messages` belong to
Meta's **Instagram Login** flow. This app holds a **Page** token and every
refusal names `instagram_manage_messages`. Different door. They have been
dropped; do not put them back.

**`pages_manage_posts` needs `pages_read_engagement`** as a hard prerequisite
(Meta lists it under `prerequisite_privileges`). Posting was therefore pulled
out of this submission rather than drag an unmet dependency through it. It
goes in the next round, with `pages_read_engagement` alongside it.

**`Human Agent` cannot pass until the Instagram permissions do** — Meta lists
its prerequisites as `instagram_business_manage_messages`,
`instagram_manage_messages` and `pages_messaging`. It only widens the reply
window from 24 hours to 7 days, so it is a nice-to-have, not a blocker.

**Two flags in `devtools_app_review requirements` are NOT trustworthy, and I
misread both.**

- **`screencast: is_completed: false` does not mean no video is attached.** It
  read `false` for `pages_messaging`, which was *approved*, and it read
  `false` after a video was demonstrably embedded in the submission. It
  appears to describe a checklist for building a *new* submission, not the
  state of the one that was sent. I told Brad "not one permission had a
  screencast attached"; Meta's own rejection text then said one had been
  submitted and judged inadequate. Read the App Review page, not this flag.
- **`can_submit: false` — "Cannot submit while a previous submission is in
  review"** appeared while the previous review was finished and while a
  submission was in fact accepted minutes later. Don't treat it as a wall.

**Where permissions are actually edited: Use cases, not the App Review page.**
The App Review page shows the result of a finished review and has no remove
button — that is not a bug and cost time to work out. Left sidebar → Use cases
→ the use case → Permissions. And you do not "remove" a rejected permission;
you simply stop requesting it. The next submission is whatever has an open
advanced-access request against it.

**Review → Testing is the API precheck, not approval.** "Testing complete"
there means the calls were made. It grants nothing. Two different pages,
easily confused.

### The screencast that was sent

A real screen recording (`Cmd+Shift+5`), 71 seconds, captions burned in with
ffmpeg. It shows: the studio dashboard; the Settings page with the Page token
saved and the Page and Instagram account connected; a customer messaging the
studio's Instagram **from instagram.com in a second browser window** — no
phone mirroring needed, which is much cleaner than filming a phone; the draft
appearing on the board; the studio owner reading it; Approve & send; and the
reply arriving in the customer's Instagram.

Two things worth keeping for next time. **The first attempt was a phone camera
pointed at a laptop** — glare, motion blur, several frames unreadable. It was
never going to pass, and it is the single easiest mistake to make here. And
**check the whole recording frame by frame before it goes to Meta**: this one
briefly showed Brad's desktop, with family photos and filenames readable,
while he switched apps. Those three seconds were cut out with ffmpeg (the
delivery shot comes *after* them, so trimming the end would have lost the
proof).

The submission notes declare the app as server-to-server with no login flow,
which is Meta's own item 5 and the honest answer for a one-user internal tool
whose only user owns the Page. Do not build a fake login screen for this.

The submission says this is an internal tool for one studio and is not sold to
other businesses — **that must stay true**, or the approval is at risk.
Selling it to other studios needs multi-tenant work and the Instagram Business
Login OAuth flow first. That is also why a public ad selling this to other
studios should wait until approval lands.


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

**The fourth approach — `/me/conversations?user_id=<IGSID>` — HAS now run
against production, and the result is worth reading carefully.**

It does not return names today. But it no longer returns 2534084 either.
Every one of the nineteen threads came back with:

    HTTP 403 (#200) App does not have Advanced Access to
    instagram_manage_messages permission, and recipient user does not have
    role on app.

and one came back `(#100) The thread owner has archived or deleted this
conversation` — a real, specific answer about a real thread, which is proof
the call shape is right and Meta processed it.

So the timeout is genuinely solved: asking by `user_id` never walks the edge,
which is what the three "ask for less" attempts could never fix. What is left
is one permission, and it is the same permission already in front of a
reviewer. **When `instagram_manage_messages` is granted, Instagram names and
profile pictures should start appearing by themselves** — no further work.
Verify that when approval lands rather than assuming it.

`getThreadParticipant()` shares `getSenderProfile`'s hour-long back-off, per
platform. It did not at first, and the first live run made one 403 per
unnamed thread every couple of minutes — exactly the red this file warns
makes real faults unreadable. A permission refusal is about the app, not the
person: the answer for the next nineteen people is already known.

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
of those had crept in and were the only non-brand colours on the page. That is
City Ink's palette — the `coffee` theme. Other studios pick their own in
Settings → Appearance (`lib/themes.ts`); the variables are the same, so the
rule is the same. The only fixed colours allowed are the Instagram and
Messenger badges, which are those apps' own, and Runnit's gold on its own
screens.

## Testing

There is no CI. Suites live in **`tests/`, in the repo**, and run against a
real MariaDB with stand-in Graph and LLM servers on localhost. `tests/run-all.sh`
runs the lot; they import from `dist/`, so `npm run build` first.

**They used to live in the session scratchpad, and a container rebuild deleted
every one of them.** Five suites went with it — the reproduction of Brad's
THEY SAID screenshots, the one that pins `group_concat_max_len` to Railway's
1024, the twelve-page browser walk — and with them the only evidence that five
real fixes had ever been proved. The fixes were still in the repo; nothing that
holds them in place was. That is the same shape as `sendfail.mjs` asserting the
wrong wording, one level up: a test that isn't there cannot stop the next
person undoing the fix. Anything written to prove a fix goes in `tests/` and is
committed with it.
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

**`calendardates.mjs` failed twice in a row once (2 October, right after a
full run): the stand-in calendar was never fetched at all ("0 reads"), so
every named-date check failed together. Every run since — alone and in five
full runs — has passed. Not explained yet; if it recurs, log whether
`getTimelyConfig()` returned the row and whether node-ical's fetch went out.

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

**Three suites for accounts, and one of them drives a browser.**
`accounts.mjs` (66 checks — the security model above), `inviteonly.mjs`
(City Ink's private mode and the claim code) and `journey.mjs` (29 checks — a
new customer on a phone from the landing page through sign up, all six
onboarding steps with real uploads, the dashboard, log out and back in, a
refresh mid-setup, a file that isn't an image, a second studio and switching
back, then a laptop and a tablet). All three start their own server on their
own database; `journey.mjs` makes its own test images with sharp. Playwright's
`getByLabel("Password")` also matches the "Show password" button — use
`/^Password/`. On a phone the desktop sidebar is still in the DOM, hidden —
select with `aside:visible`.

**Run the database and the suites on UTC, as Railway does.** This machine's
clock is Brisbane time. Node's timestamps and MySQL's `NOW()` then disagree by
ten hours, and a draft answered by hand "an hour ago" reads as answered
tomorrow. Start MariaDB with `--default-time-zone=+00:00` under `TZ=UTC`;
`inboxmeta.mjs` sets `process.env.TZ` itself.

## Working with Brad

He runs a tattoo studio; he is not a developer, and screenshots are how he
reports bugs. Read them closely — several of the worst bugs in this codebase
were visible in a screenshot before anyone understood them.

He has said: *"I shouldn't have to guide you. You should test it after you do
something and see if it works."* Take that seriously. Test against a real
database and a real browser before saying something works.

When he pushes back on a diagnosis, he has usually been right.
