import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Mail, CheckCircle2, XCircle, ChevronDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn, shortAgo } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * "We'll check with Mim."
 *
 * Brad: "If anything is written that we will check with Mim … then take a
 * screenshot and send Mim an email checking." When a reply that actually went
 * to a customer says so, Mim gets an email with a picture of the conversation.
 *
 * It sends through a small Apps Script in Brad's own Google account because
 * Railway won't let this app use Gmail's SMTP below the Pro plan. Sending as
 * him means Mim sees who it's from and her answer lands in his inbox.
 */
export default function CheckWithCard() {
  const utils = trpc.useUtils();
  const { data } = trpc.config.checkWith.useQuery();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [relayUrl, setRelayUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setEmail(data.email);
    setRelayUrl(data.relayUrl);
  }, [data]);

  const save = trpc.config.saveCheckWith.useMutation({
    onSuccess: () => {
      toast.success("Saved");
      utils.config.checkWith.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't save that."),
  });
  const test = trpc.config.testCheckWith.useMutation({
    onSuccess: (result) => (result.ok ? toast.success(result.detail) : toast.error(result.detail, { duration: 12000 })),
    onError: (error) => toast.error(error.message || "Couldn't reach the email script."),
  });

  // Grammar for when no name is saved yet: "they get", "their answer".
  const named = name.trim();
  const who = named || "them";
  const whoGets = named ? `${named} gets` : "they get";
  const whose = named ? `${named}'s` : "their";
  const connected = !!data?.relayUrl;
  const dirty = !!data && (name !== data.name || email !== data.email || relayUrl !== data.relayUrl);
  const looksRight = !relayUrl || /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\/?$/.test(relayUrl.trim());

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(data?.script ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("Couldn't copy — select the script below and copy it by hand.");
    }
  };

  return (
    <Card className="border-border scroll-mt-28" id="check-with">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-xl text-charcoal">
          <Mail className="h-4 w-4 text-sepia" />
          Checking with {name.trim() || "someone"}
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          When a reply to a customer says you'll check with {named || "someone"}, {whoGets} an email
          with a picture of the conversation. It goes from your own Gmail, so {whose} answer comes
          straight back to you. Only replies that are actually sent count — a draft you change or
          discard emails nobody.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Name, spelled the way they spell it</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mim" maxLength={40} />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-muted-foreground">Their email</span>
            <Input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@gmail.com"
            />
          </label>
        </div>

        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            data?.ready ? "border-success/40 bg-success/10 text-success" : "border-border bg-beige/20 text-charcoal"
          )}
        >
          {data?.ready ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <Mail className="mt-0.5 h-4 w-4 shrink-0 text-sepia" />}
          <span>
            {data?.ready
              ? `On. ${data.name} is emailed whenever a sent reply says you'll check with ${data.name}.`
              : !connected
                ? "Email isn't connected yet. It's a one-off, about three minutes on a computer — steps below."
                : !data?.email
                  ? `Connected. Add ${whose} email above and save.`
                  : "Add the name above and save."}
          </span>
        </div>

        <div className="rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setShowSetup((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-charcoal"
            aria-expanded={showSetup || !connected}
          >
            Connect your Gmail
            <ChevronDown className={cn("h-4 w-4 transition-transform", (showSetup || !connected) && "rotate-180")} />
          </button>
          {(showSetup || !connected) && (
            <div className="space-y-3 border-t border-border px-3 pb-3 pt-3 text-sm text-charcoal">
              <ol className="list-decimal space-y-2 pl-5 marker:text-sepia">
                <li>
                  <Button type="button" size="sm" variant="outline" onClick={copyScript}>
                    {copied ? <Check className="mr-2 h-3.5 w-3.5" /> : <Copy className="mr-2 h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy the script"}
                  </Button>
                </li>
                <li>
                  On a computer, go to{" "}
                  <a className="text-sepia underline" href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">
                    script.google.com
                  </a>{" "}
                  signed in as the Gmail it should send from. A new project opens — delete what's in it and paste.
                </li>
                <li>
                  <strong>Deploy → New deployment</strong>. Click the cog next to "Select type" → <strong>Web app</strong>.
                  Execute as: <strong>Me</strong>. Who has access: <strong>Anyone</strong>. Deploy.
                </li>
                <li>
                  Google asks you to authorise it. Pick your account. It will say Google hasn't verified the
                  app — that's expected, it's your own script: <strong>Advanced → Go to … (unsafe) → Allow</strong>.
                </li>
                <li>Copy the <strong>Web app URL</strong> (it ends in /exec), paste it below, and save.</li>
              </ol>
              <pre className="max-h-40 overflow-auto rounded-lg bg-surface p-3 text-[0.7rem] leading-relaxed text-charcoal/80">
                {data?.script ?? "…"}
              </pre>
            </div>
          )}
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-muted-foreground">Web app URL from Apps Script</span>
          <Input
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/…/exec"
            inputMode="url"
          />
        </label>
        {!looksRight && (
          <p className="text-xs text-destructive">
            That doesn't look like an Apps Script web app address — it should start with
            https://script.google.com/macros/s/ and end in /exec.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => save.mutate({ name: name.trim(), email: email.trim(), relayUrl: relayUrl.trim() })}
            disabled={save.isPending || !dirty}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !connected || dirty}>
            {test.isPending ? "Sending…" : "Send me a test"}
          </Button>
          <Button variant="outline" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? "Hide the preview" : named ? `See what ${named} gets` : "See the email picture"}
          </Button>
        </div>
        {connected && !dirty && (
          <p className="text-xs text-muted-foreground">The test goes to your own Gmail, not to {who}.</p>
        )}

        {showPreview && (
          <img
            src="/api/snapshot/sample.png"
            alt={`The picture of the conversation ${who} gets`}
            className="w-full max-w-[320px] rounded-2xl border border-border"
          />
        )}

        {!!data?.recent?.length && (
          <div>
            <p className="mb-1.5 text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">Recently</p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {data.recent.map((r) => (
                <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                  {r.status === "sent" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="text-charcoal">{r.customer}</span>
                    <span className="block break-words text-xs text-muted-foreground">
                      {r.status === "sent" ? r.detail || "Emailed" : r.detail || "Not sent"}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{shortAgo(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
