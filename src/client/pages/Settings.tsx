import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const utils = trpc.useUtils();

  const { data: fb } = trpc.config.facebook.useQuery();
  const { data: timely } = trpc.config.timely.useQuery();
  const { data: knowledge } = trpc.knowledge.list.useQuery();

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

  return (
    <div className="space-y-6">
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

          <div className="space-y-2">
            {knowledge?.map((k) => (
              <div
                key={k.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div>
                  <p className="text-sm text-charcoal">{k.question}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{k.answer}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeKnowledge.mutate({ id: k.id })}
                  aria-label="Remove"
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
