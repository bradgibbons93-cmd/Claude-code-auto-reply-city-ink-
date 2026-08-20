import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, XCircle, Sparkles, Radio } from "lucide-react";
import KnowledgeList from "@/components/KnowledgeList";
import { toast } from "sonner";

export default function Settings() {
  const utils = trpc.useUtils();

  const { data: fb } = trpc.config.facebook.useQuery();
  const { data: timely } = trpc.config.timely.useQuery();
  const { data: knowledge } = trpc.knowledge.list.useQuery();
  const { data: llm } = trpc.llm.status.useQuery();
  const { data: symphony } = trpc.symphony.status.useQuery();

  const testLlm = trpc.llm.test.useMutation({
    onSuccess: (result) => {
      if (result.ok) toast.success("AI connected");
      else toast.error("Not connected");
      utils.llm.status.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't run the test."),
  });

  const testSymphony = trpc.symphony.test.useMutation({
    onSuccess: (result) => {
      if (result.ok) toast.success("Symphony connected");
      else toast.error("Not connected");
      utils.symphony.status.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't run the test."),
  });

  const askSymphony = trpc.symphony.ask.useMutation({
    onSuccess: (result) => {
      if (result.ok && result.reply) toast.success("Symphony answered");
      else if (result.ok) toast.success("Sent — Symphony is still working on it");
      else toast.error(result.error || "Symphony didn't answer.");
      utils.symphony.status.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't reach Symphony."),
  });

  const [symphonyMessage, setSymphonyMessage] = useState("");
  const [pageId, setPageId] = useState("");
  const [pageName, setPageName] = useState("");
  const [pageAccessToken, setPageAccessToken] = useState("");
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
    onSuccess: () => {
      toast.success("Page connected");
      utils.config.facebook.invalidate();
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
  const symphonyTest = testSymphony.data;
  const symphonyReply = askSymphony.data;

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

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-xl text-charcoal">Facebook Page</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {fb?.isConfigured
              ? `Connected to ${fb.pageName || fb.pageId}.`
              : "Not connected yet. Paste the credentials from your Meta app."}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
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
          <CardTitle className="flex items-center gap-2 font-display text-xl text-charcoal">
            <Radio className="h-4 w-4 text-sepia" />
            Symphony
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Your own team of business agents, as a backstop for booking alerts. Facebook drops a
            message to your own account if you haven't written to the Page in 24 hours, so when a
            booking alert can't get through on Messenger it goes to Symphony instead. Set{" "}
            <code className="rounded bg-surface px-1">SYMPHONY_API_TOKEN</code> in Railway.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Endpoint</dt>
            <dd className="break-all text-charcoal">{symphony?.baseUrl ?? "…"}</dd>
            <dt className="text-muted-foreground">Thread</dt>
            <dd className="break-all text-charcoal">{symphony?.sessionId ?? "…"}</dd>
            <dt className="text-muted-foreground">Token</dt>
            <dd className={symphony?.configured ? "text-charcoal" : "text-destructive"}>
              {symphony?.configured ? "set" : "not set"}
            </dd>
          </dl>

          {symphonyTest && (
            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                symphonyTest.ok
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {symphonyTest.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{symphonyTest.detail}</span>
            </div>
          )}

          {!symphonyTest && symphony?.lastError && (
            <div className="rounded-lg border border-border bg-beige/20 p-3 text-sm text-charcoal">
              <p className="text-xs text-muted-foreground">Last failure</p>
              <p className="mt-1">{symphony.lastError.message}</p>
            </div>
          )}

          <Button onClick={() => testSymphony.mutate()} disabled={testSymphony.isPending}>
            {testSymphony.isPending ? "Testing…" : "Test connection"}
          </Button>

          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              Send Symphony a message. It arrives as though you sent it yourself and it can act on
              your business, so say what you actually want done — and remember an answer can take a
              minute or two.
            </p>
            <Textarea
              placeholder="e.g. Remind me on Friday to chase the deposits I'm still waiting on."
              value={symphonyMessage}
              onChange={(e) => setSymphonyMessage(e.target.value)}
              className="min-h-20"
            />
            <Button
              onClick={() => {
                if (!symphonyMessage.trim()) {
                  toast.error("Write a message first.");
                  return;
                }
                askSymphony.mutate({ message: symphonyMessage.trim() });
              }}
              disabled={askSymphony.isPending || !symphony?.configured}
            >
              {askSymphony.isPending ? "Waiting on Symphony…" : "Send to Symphony"}
            </Button>

            {symphonyReply?.reply && (
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-beige/20 p-3 text-sm text-charcoal">
                {symphonyReply.reply}
              </div>
            )}
            {symphonyReply && !symphonyReply.reply && symphonyReply.ok && (
              <p className="text-sm text-muted-foreground">
                Sent. Symphony was still working when we stopped waiting — check Symphony for the
                answer.
              </p>
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
