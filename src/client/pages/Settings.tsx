import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, XCircle, Sparkles } from "lucide-react";
import KnowledgeList from "@/components/KnowledgeList";
import { toast } from "sonner";

export default function Settings() {
  const utils = trpc.useUtils();

  // "Manage integrations" used to drop you at the top of this page, above
  // the AI card, nowhere near the connections it promised. Land on them.
  useEffect(() => {
    const target = window.location.hash.slice(1);
    if (!target) return;
    // After the first paint, or the element isn't there to scroll to yet.
    const id = window.setTimeout(
      () => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" }),
      100
    );
    return () => window.clearTimeout(id);
  }, []);

  const { data: fb } = trpc.config.facebook.useQuery();
  const { data: timely } = trpc.config.timely.useQuery();
  const { data: knowledge } = trpc.knowledge.list.useQuery();
  const { data: llm } = trpc.llm.status.useQuery();

  const testLlm = trpc.llm.test.useMutation({
    onSuccess: (result) => {
      if (result.ok) toast.success("AI connected");
      else toast.error("Not connected");
      utils.llm.status.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't run the test."),
  });

  const { data: delivery } = trpc.config.messengerDelivery.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const subscribeMessenger = trpc.config.subscribeMessenger.useMutation({
    onSuccess: (result) => {
      if (result.ok) toast.success("Page subscribed — messages will start arriving");
      else toast.error("Facebook wouldn't subscribe it");
      utils.config.messengerDelivery.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't reach Facebook."),
  });

  // Everyone who wrote in before the app was watching. A webhook only ever
  // carries the next message, so without this they stay invisible until they
  // happen to message again — which for a week-old enquiry means never.
  const importThreads = trpc.config.importThreads.useMutation({
    onSuccess: (result) => {
      if (result.conversations > 0) {
        toast.success(
          `Brought in ${result.conversations} conversation${
            result.conversations === 1 ? "" : "s"
          } and ${result.messages} message${result.messages === 1 ? "" : "s"}`
        );
      } else {
        toast("Nothing new to bring in");
      }
      utils.conversations.list.invalidate();
      utils.dashboard.invalidate();
      utils.stats.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't reach the inbox."),
  });

  const refreshNames = trpc.config.refreshNames.useMutation({
    onSuccess: (result) => {
      // A handful with no name is the resting state, not a failure: Facebook
      // will not name those people to a Page at all. Shouting "No names came
      // back" in red made a healthy inbox look broken.
      if (result.named > 0) {
        toast.success(`Named ${result.named} customer${result.named === 1 ? "" : "s"}`);
      } else {
        toast("Everyone Facebook will name is already named", { duration: 6000 });
      }
      utils.conversations.list.invalidate();
      utils.pendingReplies.list.invalidate();
      utils.dashboard.invalidate();
      utils.config.facebook.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't fetch the names."),
  });

  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [pageAccessToken, setPageAccessToken] = useState("");
  // Kept apart from the Page token on purpose — see the schema comment. One
  // box for both is how you take Messenger down while wiring up Instagram.
  const [instagramAccessToken, setInstagramAccessToken] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("city_ink_webhook_2024");
  const [bookingUrl, setBookingUrl] = useState("");
  const [calendarUrl, setCalendarUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  // The server never sends the token/app secret back down (they're
  // write-only from here), so those two stay blank on load — everything
  // else pre-fills to prove a reload didn't lose what you saved.
  useEffect(() => {
    if (!fb) return;
    setPageId(fb.pageId || "");
    setPageName(fb.pageName || "");
    setAppId(fb.appId || "");
    setVerifyToken(fb.webhookVerifyToken || "city_ink_webhook_2024");
  }, [fb]);

  useEffect(() => {
    if (timely?.bookingPageUrl) setBookingUrl(timely.bookingPageUrl);
    if (timely?.calendarIcsUrl) setCalendarUrl(timely.calendarIcsUrl);
  }, [timely]);

  const saveFacebook = trpc.config.saveFacebook.useMutation({
    onSuccess: (result) => {
      // Say what actually happened to the token. A pasted one is usually
      // swapped for the Page's own, which never expires — and knowing that
      // is the difference between doing this once and doing it every day.
      toast.success(result?.detail ?? "Page connected", { duration: 8000 });
      utils.config.facebook.invalidate();
      utils.config.messengerDelivery.invalidate();
    },
    // Reporting the real error matters: this used to always blame empty
    // fields, which sent you hunting through the form when the actual
    // failure was the database.
    onError: (error) => toast.error(error.message || "Couldn't save the Page details."),
  });

  const saveTimely = trpc.config.saveTimely.useMutation({
    onSuccess: () => {
      toast.success("Calendar saved");
      utils.config.timely.invalidate();
    },
    onError: (error) => toast.error(error.message || "That doesn't look like a valid URL."),
  });

  const addKnowledge = trpc.knowledge.create.useMutation({
    onSuccess: () => {
      toast.success("Added");
      setQuestion("");
      setAnswer("");
      utils.knowledge.list.invalidate();
    },
  });

  const removeKnowledge = trpc.knowledge.remove.useMutation({
    onSuccess: () => utils.knowledge.list.invalidate(),
  });

  const result = testLlm.data;

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-xl text-charcoal">
            <Sparkles className="h-4 w-4 text-sepia" />
            AI connection
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            The agent can't draft anything without this. Set{" "}
            <code className="rounded bg-surface px-1">LLM_PROVIDER</code>,{" "}
            <code className="rounded bg-surface px-1">LLM_BASE_URL</code>,{" "}
            <code className="rounded bg-surface px-1">LLM_MODEL</code> and{" "}
            <code className="rounded bg-surface px-1">LLM_API_KEY</code> in Railway, then test it
            here — no need to wait for a customer to message in to find out.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Provider</dt>
            <dd className="text-charcoal">{llm?.provider ?? "…"}</dd>
            <dt className="text-muted-foreground">Model</dt>
            <dd className="break-all text-charcoal">{llm?.model ?? "…"}</dd>
            <dt className="text-muted-foreground">Endpoint</dt>
            <dd className="break-all text-charcoal">{llm?.baseUrl ?? "…"}</dd>
            <dt className="text-muted-foreground">Key</dt>
            <dd className={llm?.keySet ? "text-charcoal" : "text-destructive"}>
              {llm?.keySet ? "set" : "not set"}
            </dd>
          </dl>

          {result && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                result.ok
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {result.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{result.detail}</span>
            </div>
          )}

          {!result && llm?.lastError && (
            <div className="rounded-lg border border-border bg-beige/20 p-3 text-sm text-charcoal">
              <p className="text-xs text-muted-foreground">Last failure</p>
              <p className="mt-1">{llm.lastError.message}</p>
            </div>
          )}

          <Button onClick={() => testLlm.mutate()} disabled={testLlm.isPending}>
            {testLlm.isPending ? "Testing…" : "Test connection"}
          </Button>
        </CardContent>
      </Card>

      {/* Whether Facebook is sending anything at all. Verifying the webhook
          URL is only half of it — the Page has to be subscribed to the app,
          and until it is Facebook delivers nothing and reports nothing. */}
      <Card className="border-border" id="delivery">
        <CardHeader>
          <CardTitle className="font-display text-xl text-charcoal">
            Messenger delivery
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Whether Facebook is actually handing this Page's messages to the app. If nothing is
            reaching the queue, the answer is almost always here.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Facebook delivering and the app refusing is the worst of the
              failures and the least visible: every other panel reads healthy
              while real enquiries are turned away. It goes above everything. */}
          {delivery?.rejected && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <strong>
                Facebook is sending {delivery.rejected.count} message
                {delivery.rejected.count === 1 ? "" : "s"} that this app is turning away.
              </strong>{" "}
              They're being rejected because the saved <strong>App secret</strong> doesn't match
              the one Facebook signs with — so the messages are real, and they aren't getting in.
              Copy the App secret from the Meta app dashboard (Settings → Basic → App secret →
              Show) into the box below and save. Facebook retries, so recent ones should land
              once it matches.
              {delivery.rejected.detail && (
                <>
                  {" "}
                  <span className="mt-2 block font-mono text-xs opacity-80">
                    Last one: {delivery.rejected.detail}
                  </span>
                </>
              )}
            </div>
          )}

          <div
            className={`rounded-lg border p-3 text-sm ${
              delivery?.subscribed && !delivery?.missing?.length
                ? "border-success/40 bg-success/10 text-success"
                : delivery?.unknown
                  ? "border-border bg-beige/30 text-charcoal"
                  : "border-destructive/40 bg-destructive/5 text-destructive"
            }`}
          >
            {delivery?.detail ?? "Checking…"}
          </div>

          {/* "no" and "we couldn't ask" are different answers. Printing the
              first when we meant the second turned an expired token into a
              hunt for a subscription that was never broken. */}
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Page subscribed</dt>
            <dd className="text-charcoal">
              {!delivery ? "…" : delivery.unknown ? "couldn't check" : delivery.subscribed ? "yes" : "no"}
            </dd>
            <dt className="text-muted-foreground">Events</dt>
            <dd className="break-all text-charcoal">
              {delivery?.unknown
                ? "couldn't check"
                : delivery?.fields?.length
                  ? delivery.fields.join(", ")
                  : "none"}
            </dd>
            <dt className="text-muted-foreground">Last delivery</dt>
            <dd className="text-charcoal">
              {delivery?.lastDelivery
                ? `${new Date(delivery.lastDelivery.at).toLocaleString()} (${delivery.lastDelivery.kind})`
                : "nothing has ever arrived"}
            </dd>
          </dl>

          <Button
            onClick={() => subscribeMessenger.mutate()}
            disabled={subscribeMessenger.isPending}
          >
            {subscribeMessenger.isPending ? "Subscribing…" : "Subscribe this Page"}
          </Button>

          {subscribeMessenger.data && (
            <p className="break-words text-xs text-charcoal">{subscribeMessenger.data.detail}</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border" id="connections">
        <CardHeader>
          <CardTitle className="font-display text-xl text-charcoal">Facebook Page</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {fb?.isConfigured
              ? `Connected to ${fb.pageName || fb.pageId}.`
              : "Not connected yet. Paste the credentials from your Meta app."}
          </p>
          <div className="mt-3 rounded-lg border border-border bg-beige/20 p-3">
            <p className="text-xs text-muted-foreground">
              Showing customers as "a customer"? Their names are looked up when they message
              in — threads that arrived before the Page was connected never got one. This goes
              back and fetches them.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refreshNames.mutate()}
              disabled={refreshNames.isPending}
            >
              {refreshNames.isPending ? "Fetching…" : "Fetch customer names"}
            </Button>
            {refreshNames.data && (
              <p className="mt-2 break-words text-xs text-charcoal">{refreshNames.data.detail}</p>
            )}
            {/* Not red, and not a Graph dump. Facebook refusing to hand over
                a few names is the normal state of affairs, not a fault —
                painting it as an error sent Brad chasing it twice. */}
            {!refreshNames.data && fb?.lastProfileError && (
              <p className="mt-2 break-words text-xs text-muted-foreground">
                {fb.lastProfileError.message}
              </p>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-border bg-beige/20 p-3">
            <p className="text-xs text-muted-foreground">
              Someone messaged before the app was watching? Facebook only ever sends what
              happens next, so older threads never arrive. This reads the studio inbox and
              brings in what's already there. It doesn't draft or send anything.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => importThreads.mutate()}
              disabled={importThreads.isPending}
            >
              {importThreads.isPending ? "Bringing them in…" : "Import existing conversations"}
            </Button>
            {importThreads.data && (
              <p className="mt-2 break-words text-xs text-charcoal">
                {importThreads.data.detail}
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* The state of the saved token, before anything else on this card.
              An expired one takes down messages, names and the import all at
              once, and every panel then reports its own symptom instead of
              the cause. */}
          {fb?.token && (
            <div
              className={`rounded-lg border p-3 text-sm ${
                !fb.token.valid
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : fb.token.permanent
                    ? "border-success/40 bg-success/10 text-success"
                    : "border-border bg-beige/30 text-charcoal"
              }`}
            >
              {!fb.token.valid ? (
                <>
                  <strong>The saved Page token has expired.</strong> Nothing can be read from
                  Facebook until it's replaced — no new messages, no names, no import. Paste a
                  new one below; the user token from the Graph API Explorer is fine, the app
                  swaps it for the Page's own permanent one.
                </>
              ) : fb.token.permanent ? (
                "Page token is good and has no expiry — this shouldn't need doing again."
              ) : (
                <>
                  <strong>This token expires {new Date(fb.token.expiresAt!).toLocaleString("en-AU", {
                    day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
                  })}.</strong>{" "}
                  Paste the user token from the Graph API Explorer below and the app will trade
                  it for a permanent one.
                </>
              )}
            </div>
          )}
          <Input placeholder="Page ID" value={pageId} onChange={(e) => setPageId(e.target.value)} />
          <Input
            placeholder="Page name (optional)"
            value={pageName}
            onChange={(e) => setPageName(e.target.value)}
          />
          <Input
            placeholder={fb?.hasToken ? "Page access token — saved, leave blank to keep it" : "Page access token"}
            type="password"
            value={pageAccessToken}
            onChange={(e) => setPageAccessToken(e.target.value)}
          />
          <Input
            placeholder={
              fb?.hasInstagramToken
                ? "Instagram access token — saved, leave blank to keep it"
                : "Instagram access token (optional)"
            }
            type="password"
            value={instagramAccessToken}
            onChange={(e) => setInstagramAccessToken(e.target.value)}
          />
          <Input placeholder="App ID" value={appId} onChange={(e) => setAppId(e.target.value)} />
          <Input
            placeholder={fb?.isConfigured ? "App secret — saved, leave blank to keep it" : "App secret"}
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
          />
          <Input
            placeholder="Webhook verify token"
            value={verifyToken}
            onChange={(e) => setVerifyToken(e.target.value)}
          />
          <Button
            onClick={() =>
              saveFacebook.mutate({
                pageId,
                pageName: pageName || undefined,
                pageAccessToken,
                appId,
                appSecret,
                webhookVerifyToken: verifyToken,
                instagramAccessToken: instagramAccessToken || undefined,
              })
            }
            disabled={saveFacebook.isPending}
          >
            {saveFacebook.isPending ? "Saving…" : "Connect Page"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-xl text-charcoal">Booking alerts</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Bookings are entered by hand — the agent collects the customer's name, phone, and
            preferred dates, then messages the studio's own Facebook account so it can be typed
            into Timely.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div
            className={`rounded-lg border p-3 text-sm ${
              fb?.hasOwner
                ? "border-success/40 bg-success/10 text-success"
                : "border-border bg-beige/20 text-charcoal"
            }`}
          >
            {fb?.hasOwner ? (
              "An alert contact is registered — booking pings will land in that Messenger chat."
            ) : (
              <>
                No alert contact yet. From the personal Facebook account that should receive
                bookings, message the City Ink Page:{" "}
                <code className="rounded bg-surface px-1">
                  set owner {verifyToken || "<your webhook verify token>"}
                </code>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-xl text-charcoal">Calendar</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {timely?.calendarIcsUrl
              ? "Connected — the agent checks this before offering any time, and only offers slots that are actually free."
              : "Paste the private iCal address of the Google Calendar that Timely syncs into. Without it the agent won't name a time, it'll say it's checking and get back to them."}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="https://calendar.google.com/calendar/ical/.../private-.../basic.ics"
            value={calendarUrl}
            onChange={(e) => setCalendarUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Google Calendar → the calendar's ⋮ → Settings and sharing → scroll to{" "}
            <span className="text-charcoal/80">Secret address in iCal format</span> → copy. Treat
            it like a password — anyone with it can read the calendar.
          </p>

          <Input
            placeholder="Timely booking page (optional, for your reference)"
            value={bookingUrl}
            onChange={(e) => setBookingUrl(e.target.value)}
          />
          <Button
            onClick={() =>
              saveTimely.mutate({
                bookingPageUrl: bookingUrl || "https://bookings.gettimely.com/cityinktattoo/bb/book",
                calendarIcsUrl: calendarUrl,
              })
            }
            disabled={saveTimely.isPending}
          >
            {saveTimely.isPending ? "Saving…" : "Save calendar"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-xl text-charcoal">What the agent knows</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Opening hours, deposit policy, parking, minimum age. Anything not in here, the agent
            won't claim to know.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Input
              placeholder="What do customers ask?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Textarea
              placeholder="The answer, in your words."
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className="min-h-20"
            />
            <Button
              onClick={() => {
                if (!question.trim() || !answer.trim()) {
                  toast.error("Fill in both the question and the answer.");
                  return;
                }
                addKnowledge.mutate({ question, answer });
              }}
              disabled={addKnowledge.isPending}
            >
              Add
            </Button>
          </div>

          <KnowledgeList />
        </CardContent>
      </Card>
    </div>
  );
}
