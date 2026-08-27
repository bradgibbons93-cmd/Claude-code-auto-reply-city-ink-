import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useReveal } from "@/lib/useReveal";
import { Avatar } from "@/components/Avatar";
import { StampBadge } from "@/components/Logo";
import {
  AlertTriangle,
  Send,
  Trash2,
  Sparkles,
  Instagram,
  Facebook,
} from "lucide-react";

function isPaused(until: string | Date | null | undefined) {
  return !!until && new Date(until) > new Date();
}

function StatTile({
  label,
  value,
  hint,
  emphasise,
}: {
  label: string;
  value: number | undefined;
  hint?: string;
  emphasise?: boolean;
}) {
  return (
    <Card className={cn(emphasise && value ? "border-sepia/40 shadow-glow" : undefined)}>
      <CardContent className="pt-6">
        {value === undefined ? (
          <div className="shimmer h-9 w-14 animate-shimmer rounded-md bg-beige/25" />
        ) : (
          <p className="font-display text-3xl text-charcoal tabular-nums">{value}</p>
        )}
        <p className="mt-2 text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        {hint && <p className="mt-1 text-xs text-sepia">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function PendingReplyCard({
  draft,
  senderName,
  onOpenThread,
}: {
  draft: {
    id: number;
    conversationId: string;
    customerMessageId: string;
    photoUrls?: string[];
    alternatives?: { label: string; text: string }[] | null;
    draftText: string;
    isSensitive?: boolean | null;
    llmFailed?: boolean | null;
    createdAt: string | Date | null;
  };
  senderName: string;
  onOpenThread: (conversationId: string) => void;
}) {
  const utils = trpc.useUtils();
  const [text, setText] = useState(draft.draftText);

  // What the customer actually said, so the draft can be judged without
  // having to go hunting for the thread first.
  const { data: thread } = trpc.conversations.messages.useQuery({
    conversationId: draft.conversationId,
  });
  // The message this draft was actually written for. Showing the newest
  // message in the thread instead made correct drafts look wrong — a reply to
  // "where are you located" was labelled with a later "how much is this",
  // so it read as though the agent had answered the wrong question.
  const answering =
    (thread ?? []).find((m) => m.messageId === draft.customerMessageId) ??
    [...(thread ?? [])].reverse().find((m) => m.senderType === "customer");

  // Reference photos come down with the draft, gathered across the thread —
  // they usually arrive a message or two BEFORE the question ("(sent a
  // photo)" then "a price on those two please"), so keying them to the
  // answered message alone meant pricing a tattoo you couldn't see. Assembled
  // server-side so this page and the dashboard can't disagree.
  const recentPhotos = draft.photoUrls ?? [];

  // The agent's first answer plus the other angles it offered, as one list to
  // choose between. The first is what it led with.
  const options = [
    { label: "Recommended", text: draft.draftText },
    ...(draft.alternatives ?? []),
  ];

  const approve = trpc.pendingReplies.approve.useMutation({
    onSuccess: () => {
      toast.success("Sent");
      utils.pendingReplies.list.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't send that reply."),
  });
  const reject = trpc.pendingReplies.reject.useMutation({
    onSuccess: () => {
      toast("Discarded — nothing was sent");
      utils.pendingReplies.list.invalidate();
    },
  });

  const busy = approve.isPending || reject.isPending;

  return (
    <Card
      className={cn(
        "animate-fade-up",
        draft.isSensitive || draft.llmFailed
          ? "border-destructive/40 bg-destructive/[0.03]"
          : "border-sepia/25"
      )}
    >
      <CardContent className="space-y-3 pt-6">
        {/* Two different reasons a person is needed, and conflating them told
            Brad a perfectly ordinary enquiry about wait times was "something
            personal". One is about the customer; the other is our own outage. */}
        {draft.isSensitive && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">
              They've raised something personal. This draft is only a holding line — read the
              thread and reply yourself.
            </p>
          </div>
        )}

        {!draft.isSensitive && draft.llmFailed && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">
              Nothing wrong with this message — the AI didn't finish a draft for it, so there's
              nothing to approve. Write the reply yourself. Settings → AI has a Test button that
              says why.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => onOpenThread(draft.conversationId)}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            <Avatar name={senderName} className="h-7 w-7" />
            <span className="truncate text-sm text-charcoal underline-offset-2 hover:underline">
              {senderName}
            </span>
          </button>
          {draft.createdAt && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(draft.createdAt), { addSuffix: true })}
            </span>
          )}
        </div>

        {answering && (
          <div className="rounded-xl bg-surface px-3 py-2">
            <p className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
              They said
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-charcoal">{answering.content}</p>
            {!!recentPhotos.length && (
              <div className="mt-2 flex flex-wrap gap-2">
                {recentPhotos.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={url}
                      alt="Reference photo the customer sent"
                      className="h-28 w-28 rounded-lg border border-border object-cover"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.18em] text-sepia">
            <Sparkles className="h-3 w-3" />
            Draft reply
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-24"
            placeholder={draft.llmFailed ? `Write your reply to ${senderName}…` : undefined}
            aria-label={`Draft reply to ${senderName}`}
          />

          {/* Other ways of answering the same message. Picking one loads it
              above to edit — nothing sends until Approve is pressed. */}
          {options.length > 1 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                Or say it like
              </span>
              {options.map((option, index) => {
                const chosen = text === option.text;
                return (
                  <button
                    key={option.label + index}
                    type="button"
                    onClick={() => setText(option.text)}
                    title={option.text}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      chosen
                        ? "border-sepia bg-sepia/10 text-sepia"
                        : "border-border text-muted-foreground hover:border-sepia/60 hover:text-charcoal"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => approve.mutate({ id: draft.id, editedText: text })}
            disabled={busy || !text.trim()}
          >
            <Send className="mr-2 h-3.5 w-3.5" />
            {approve.isPending ? "Sending…" : "Approve & send"}
          </Button>
          <Button variant="outline" onClick={() => reject.mutate({ id: draft.id })} disabled={busy}>
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Discard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Conversations() {
  const [selected, setSelected] = useState<string | null>(null);
  const inboxRef = useReveal<HTMLDivElement>();

  const { data: stats } = trpc.stats.useQuery({} as never, { refetchInterval: 30000 });
  const { data: conversations, refetch } = trpc.conversations.list.useQuery(undefined, {
    refetchInterval: 20000,
  });
  const { data: messages } = trpc.conversations.messages.useQuery(
    { conversationId: selected ?? "" },
    { enabled: !!selected, refetchInterval: 10000 }
  );
  const { data: pendingReplies } = trpc.pendingReplies.list.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const pause = trpc.conversations.pause.useMutation({
    onSuccess: () => {
      toast.success("Agent paused on this thread");
      refetch();
    },
  });
  const resume = trpc.conversations.resume.useMutation({
    onSuccess: () => {
      toast.success("Agent back on");
      refetch();
    },
  });

  const active = conversations?.find((c) => c.conversationId === selected);
  const senderNameFor = (conversationId: string) =>
    conversations?.find((c) => c.conversationId === conversationId)?.senderName || "a customer";

  const waiting = pendingReplies?.length ?? 0;
  const sensitiveCount = pendingReplies?.filter((d) => d.isSensitive).length ?? 0;
  const failedCount = pendingReplies?.filter((d) => d.llmFailed && !d.isSensitive).length ?? 0;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Threads" value={stats?.conversations} />
        <StatTile label="Messages" value={stats?.messages} />
        <StatTile
          label="Awaiting your OK"
          value={pendingReplies?.length}
          hint={
            [
              sensitiveCount ? `${sensitiveCount} needs a person` : "",
              failedCount ? `${failedCount} the AI couldn't write` : "",
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
          emphasise
        />
        <StatTile label="Posts queued" value={stats?.pendingPosts} />
      </div>

      {waiting > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg tracking-[0.1em] text-charcoal">
            Waiting for your OK
            <span className="ml-2 text-sepia">({waiting})</span>
          </h2>
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {pendingReplies?.map((draft) => (
              <PendingReplyCard
                key={draft.id}
                draft={draft}
                senderName={senderNameFor(draft.conversationId)}
                onOpenThread={setSelected}
              />
            ))}
          </div>
        </section>
      )}

      <div ref={inboxRef} className="grid gap-6 md:grid-cols-[290px_1fr]">
        <div className="space-y-2">
          <h2 className="px-1 font-display text-sm tracking-[0.14em] text-muted-foreground">
            INBOX
          </h2>
          {conversations?.length ? (
            conversations.map((c) => (
              <button
                key={c.conversationId}
                onClick={() => setSelected(c.conversationId)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all duration-300",
                  selected === c.conversationId
                    ? "border-sepia/45 bg-beige/20 shadow-soft"
                    : "border-border bg-card hover:border-beige hover:shadow-soft"
                )}
              >
                <Avatar name={c.senderName || "?"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {/* Which inbox this is really in. Half the studio's
                          enquiries come through Instagram, and the reply
                          goes back to wherever it came from. */}
                      {c.platform === "instagram" ? (
                        <Instagram className="h-3 w-3 shrink-0 text-sepia" aria-label="Instagram" />
                      ) : (
                        <Facebook className="h-3 w-3 shrink-0 text-sepia" aria-label="Messenger" />
                      )}
                      <span className="truncate text-sm text-charcoal">
                        {c.senderName || "Unknown customer"}
                      </span>
                    </span>
                    {isPaused(c.botPausedUntil) && (
                      <Badge className="border-sepia/40 bg-beige/30 text-[0.6rem] text-sepia">
                        You
                      </Badge>
                    )}
                  </div>
                  {c.lastMessageAt && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true })}
                    </p>
                  )}
                </div>
              </button>
            ))
          ) : (
            <Card>
              <CardContent className="pt-6">
                <StampBadge className="mx-auto mb-4 h-24 w-24 text-sepia opacity-70" />
                <p className="text-sm text-muted-foreground">
                  No messages yet. Connect the Page in Settings, then send your studio a test
                  message.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div>
          {!selected ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Pick a thread to read it.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={active?.senderName || "Customer"} />
                  <h2 className="font-display text-lg tracking-[0.08em] text-charcoal">
                    {active?.senderName || "Customer"}
                  </h2>
                </div>
                {isPaused(active?.botPausedUntil) ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => resume.mutate({ conversationId: selected })}
                  >
                    Hand back to agent
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => pause.mutate({ conversationId: selected, hours: 12 })}
                  >
                    Take over
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                {messages?.map((m) => (
                  <div
                    key={m.id}
                    className={cn(
                      "max-w-[85%] animate-fade-up rounded-2xl px-4 py-2.5 text-sm",
                      m.senderType === "customer"
                        ? "border border-border bg-card text-charcoal shadow-soft"
                        : "ml-auto bg-primary text-primary-foreground"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {!!m.attachmentUrls?.length && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.attachmentUrls.map((url) => (
                          <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={url}
                              alt="Reference photo"
                              className="h-32 w-32 rounded-lg object-cover"
                              loading="lazy"
                            />
                          </a>
                        ))}
                      </div>
                    )}
                    <p
                      className={cn(
                        "mt-1 text-[0.65rem]",
                        m.senderType === "customer" ? "text-muted-foreground" : "text-primary-foreground/60"
                      )}
                    >
                      {m.senderType === "manual"
                        ? "Studio (typed)"
                        : m.senderType === "bot"
                          ? "Sent by agent"
                          : "Customer"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
