import { useState } from "react";
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
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  const saveFacebook = trpc.config.saveFacebook.useMutation({
    onSuccess: () => {
      toast.success("Page connected");
      utils.config.facebook.invalidate();
    },
    onError: () => toast.error("Couldn't save. Every field is required."),
  });

  const saveTimely = trpc.config.saveTimely.useMutation({
    onSuccess: () => {
      toast.success("Booking link saved");
      utils.config.timely.invalidate();
    },
    onError: () => toast.error("That doesn't look like a valid URL."),
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
      <Card className="border-amber-500/20">
        <CardHeader>
          <CardTitle className="font-serif text-xl text-amber-400">Facebook Page</CardTitle>
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
            placeholder="Page access token"
            type="password"
            value={pageAccessToken}
            onChange={(e) => setPageAccessToken(e.target.value)}
          />
          <Input placeholder="App ID" value={appId} onChange={(e) => setAppId(e.target.value)} />
          <Input
            placeholder="App secret"
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

      <Card className="border-amber-500/20">
        <CardHeader>
          <CardTitle className="font-serif text-xl text-amber-400">Booking link</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            {timely?.bookingPageUrl
              ? `Sending customers to ${timely.bookingPageUrl}`
              : "The agent won't offer bookings until this is set."}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="https://cityink.gettimely.com/book"
            value={bookingUrl}
            onChange={(e) => setBookingUrl(e.target.value)}
          />
          <Button
            onClick={() => saveTimely.mutate({ bookingPageUrl: bookingUrl })}
            disabled={saveTimely.isPending}
          >
            {saveTimely.isPending ? "Saving…" : "Save link"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-amber-500/20">
        <CardHeader>
          <CardTitle className="font-serif text-xl text-amber-400">What the agent knows</CardTitle>
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
                className="flex items-start justify-between gap-3 rounded-lg border border-amber-500/15 p-3"
              >
                <div>
                  <p className="text-sm text-amber-400">{k.question}</p>
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
