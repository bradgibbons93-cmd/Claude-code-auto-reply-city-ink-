import { useEffect, useRef, useState } from "react";
import { useSearch } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import PhotoViewer from "@/components/PhotoViewer";
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
  RefreshCw,
  Copy,
  Check,
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
  avatarUrl,
  platform,
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
    sendError?: string | null;
    createdAt: string | Date | null;
  };
  senderName: string;
  platform?: string | null;
  avatarUrl?: string | null;
  onOpenThread: (conversationId: string) => void;
}) {
  const utils = trpc.useUtils();
  const [text, setText] = useState(draft.draftText);
  const [copied, setCopied] = useState(false);

  // Why the model couldn't write this one. Only read when a draft actually
  // failed, so a healthy board never asks.
  const { data: llmStatus } = trpc.llm.status.useQuery(undefined, {
    enabled: !!draft.llmFailed,
    staleTime: 60000,
  });
  const llmError = llmStatus?.lastError?.message;

  // A retry rewrites the draft underneath this box. Without this the new
  // wording arrives on the server and the studio keeps staring at the empty
  // box it replaced. Keyed on the text itself, so the twenty-second poll
  // can't wipe out something half-typed.
  useEffect(() => setText(draft.draftText), [draft.draftText]);

  // What the customer actually said, so the draft can be judged without
  // having to go hunting for the thread first.
  const { data: threadPage } = trpc.conversations.messages.useQuery({
    conversationId: draft.conversationId,
  });
  const thread = threadPage?.messages;
  // The message this draft was actually written for. Showing the newest
  // message in the thread instead made correct drafts look wrong — a reply to
  // "where are you located" was labelled with a later "how much is this",
  // so it read as though the agent had answered the wrong question.
  // Both halves insist the message is actually the CUSTOMER'S.
  //
  // The id lookup didn't, and Brad caught it: a card headed "THEY SAID" with
  // the studio's own quote under it — "Hi Rebecca, Tattoo 1 ... $300-$350 ...
  // Thank you so much 😊 xx" — presented as Rebecca's words. If a draft's
  // customerMessageId ever points at one of our own messages, rendering it
  // unchecked puts our words in the customer's mouth on the one screen the
  // studio trusts. The data fault is fixed at source too, but this is the
  // line that makes the symptom impossible.
  const answering =
    (thread ?? []).find(
      (m) => m.messageId === draft.customerMessageId && m.senderType === "customer"
    ) ?? [...(thread ?? [])].reverse().find((m) => m.senderType === "customer");

  // Reference photos come down with the draft, gathered across the thread —
  // they usually arrive a message or two BEFORE the question ("(sent a
  // photo)" then "a price on those two please"), so keying them to the
  // answered message alone meant pricing a tattoo you couldn't see. Assembled
  // server-side so this page and the dashboard can't disagree.
  const recentPhotos = draft.photoUrls ?? [];
  // Which reference photo is open, if any. -1 is closed.
  const [photo, setPhoto] = useState(-1);

  // Anything older than a fortnight is almost certainly cold, and quite
  // possibly answered by hand somewhere this app can't see. Saying so beats
  // letting the studio send a stranger a reply to something they wrote in
  // June as though no time had passed.
  const askedAt = answering?.createdAt ? new Date(answering.createdAt) : null;
  const isStale = !!askedAt && Date.now() - askedAt.getTime() > 14 * 24 * 3600 * 1000;

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
    onError: (error) => {
      // The draft is put back on the board by the server when a send fails,
      // so refresh — otherwise the card stays gone on screen and the toast
      // is the only trace of a customer who never got answered.
      utils.pendingReplies.list.invalidate();
      toast.error(error.message || "Couldn't send that reply.", { duration: 10000 });
    },
  });
  // The model fell over on this one. Asking it again is nearly always faster
  // than typing the reply out, so offer that before the blank box.
  const redraft = trpc.pendingReplies.redraft.useMutation({
    onSuccess: (result) => {
      if (result.ok) {
        toast.success("Drafted — have a read before it goes");
        utils.pendingReplies.list.invalidate();
      } else {
        toast.error(result.reason || "Still couldn't write that one.");
      }
    },
    onError: (error) => toast.error(error.message || "Couldn't reach the AI."),
  });
  const reject = trpc.pendingReplies.reject.useMutation({
    onSuccess: () => {
      toast("Discarded — nothing was sent");
      utils.pendingReplies.list.invalidate();
    },
  });

  const busy = approve.isPending || reject.isPending || redraft.isPending;

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
              nothing to approve.{" "}
              {/* The reason, here, rather than "Settings → AI has a Test button
                  that says why". The server already knows: sending someone to
                  go and press a button to be told something we could have
                  printed is a trip for nothing, and every message will land
                  like this until the cause is fixed. */}
              {llmError ? (
                <>
                  <span className="font-medium">{llmError}</span> Write the reply yourself in the
                  meantime.
                </>
              ) : (
                <>Write the reply yourself. Settings → AI has a Test button that says why.</>
              )}
            </p>
          </div>
        )}

        {isStale && askedAt && (
          <div className="flex items-start gap-2 rounded-xl border border-sepia/40 bg-beige/25 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sepia" />
            <p className="text-xs text-charcoal">
              This is from {format(askedAt, "d MMMM")} — check the thread before sending, in case
              it was already answered somewhere else.
            </p>
          </div>
        )}

        {/* This one was approved and did NOT reach the customer. The card
            used to disappear on a failed send, which read as "sent" and left
            the person waiting on an answer nobody knew hadn't gone. */}
        {!!draft.sendError && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/45 bg-destructive/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs text-destructive">
              <span className="font-medium">This didn't send.</span> {draft.sendError}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => onOpenThread(draft.conversationId)}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            <Avatar name={senderName} src={avatarUrl} className="h-7 w-7" />
            {/* Which inbox this reply goes back to. Brad works both and needs
                to know which conversation he's in without opening it. */}
            {platform === "instagram" ? (
              <Instagram className="h-3 w-3 shrink-0 text-sepia" aria-label="Instagram" />
            ) : (
              <Facebook className="h-3 w-3 shrink-0 text-sepia" aria-label="Messenger" />
            )}
            <span className="truncate text-sm text-charcoal underline-offset-2 hover:underline">
              {senderName}
            </span>
          </button>
          {/* When the CUSTOMER wrote, not when the draft was written. A June
              enquiry showing "less than a minute ago" because the agent had
              just drafted for it is how an old, already-answered thread came
              to look like a live one. */}
          {(answering?.createdAt || draft.createdAt) && (
            <span
              className={cn(
                "shrink-0 text-xs",
                isStale ? "text-destructive" : "text-muted-foreground"
              )}
              title={
                answering?.createdAt
                  ? `They wrote this ${format(new Date(answering.createdAt), "d MMM yyyy, HH:mm")}`
                  : undefined
              }
            >
              {formatDistanceToNow(new Date((answering?.createdAt ?? draft.createdAt) as string), {
                addSuffix: true,
              })}
            </span>
          )}
        </div>

        {answering && (
          <div className="rounded-xl bg-surface px-3 py-2">
            <p className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
              They said
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-charcoal">{answering.content}</p>
            {photo >= 0 && (
              <PhotoViewer
                urls={recentPhotos}
                index={photo}
                onIndex={setPhoto}
                onClose={() => setPhoto(-1)}
                alt="Reference photo the customer sent"
              />
            )}
            {!!recentPhotos.length && (
              <div className="mt-2 flex flex-wrap gap-2">
                {recentPhotos.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setPhoto(i)}
                    className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <img
                      src={url}
                      alt="Reference photo the customer sent"
                      className="h-28 w-28 rounded-lg border border-border object-cover"
                      loading="lazy"
                    />
                  </button>
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
          {/* Until Meta lets the app message customers, the reply still has
              to reach them somehow — and retyping a draft into Instagram is
              the fastest way to stop using the draft at all. One tap, then
              paste. Shown always, because copying is useful even when
              sending works. */}
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                toast.error("Couldn't copy — select the text and copy it by hand.");
              }
            }}
            disabled={!text.trim()}
            title="Copy this reply, then paste it into Instagram or Messenger"
          >
            {copied ? (
              <Check className="mr-2 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-2 h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            onClick={() => approve.mutate({ id: draft.id, editedText: text })}
            disabled={busy || !text.trim()}
          >
            <Send className="mr-2 h-3.5 w-3.5" />
            {approve.isPending ? "Sending…" : "Approve & send"}
          </Button>
          {draft.llmFailed && (
            <Button
              variant="outline"
              onClick={() => redraft.mutate({ id: draft.id })}
              disabled={busy}
            >
              <RefreshCw
                className={cn("mr-2 h-3.5 w-3.5", redraft.isPending && "animate-spin")}
              />
              {redraft.isPending ? "Asking the AI…" : "Try the AI again"}
            </Button>
          )}
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
  // ?thread=… so a search result, a notification, or a link from the
  // dashboard opens the right conversation — and survives a refresh, which
  // a selection held only in React state never did.
  const [selected, setSelected] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("thread")
  );
  const [search, setSearch] = useState("");
  // The split Brad works from: who is waiting on whom. Derived from who
  // spoke last, so there's nothing to keep up to date by hand.
  const [filter, setFilter] = useState<"all" | "needs" | "waiting" | "mine">("all");
  const inboxRef = useReveal<HTMLDivElement>();
  // Navigating to /messages?thread=… while already on the page doesn't
  // remount, so the initial state above wouldn't fire a second time.
  const routeSearch = useSearch();
  useEffect(() => {
    const thread = new URLSearchParams(routeSearch).get("thread");
    if (thread) setSelected(thread);
  }, [routeSearch]);
  const utils = trpc.useUtils();

  const { data: stats } = trpc.stats.useQuery({} as never, { refetchInterval: 30000 });
  const { data: conversations, refetch } = trpc.conversations.list.useQuery(undefined, {
    refetchInterval: 20000,
  });
  // How far back the thread view is currently reading. Null means "the most
  // recent window"; a number is the oldest message id already on screen, and
  // the query then fetches the window before it.
  //
  // `windowSize` grows instead of stitching pages together in state. It keeps
  // the ten-second refetch honest — a stitched list would have to decide what
  // to do with a new message arriving while the studio is scrolled back
  // through last month, and asking for a bigger window has no such problem.
  const [windowSize, setWindowSize] = useState(50);
  // Which photo in the thread is open. Carries its whole message's set, so
  // the arrows step through the reference photos that arrived together.
  const [threadPhoto, setThreadPhoto] = useState<{ urls: string[]; index: number } | null>(null);

  /*
   * Brad: "I can't scroll up in the messages to see previous."
   *
   * The thread had no scroll area of its own, so on a phone it was just more
   * page. Opening a thread left the view wherever it already was — thousands
   * of pixels up, on the dashboard counters and the draft board — and
   * scrolling up inside a conversation walked back out of it into the board
   * instead of reaching older messages. "Load older messages" was real and
   * sat at the top of that buried block, so he never saw it.
   *
   * Two effects fix it, and both are what a messaging app does:
   *   - opening a thread brings it into view and lands on the NEWEST message
   *   - the message list scrolls itself, so up means further back in the
   *     conversation, every time
   */
  const threadPanel = useRef<HTMLDivElement>(null);
  const messageList = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected) return;
    threadPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Newest last, so the bottom is where the conversation actually is.
    const list = messageList.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [selected]);

  // Loading older messages must not yank the view. Keep the message that was
  // under the thumb where it was by restoring the distance from the bottom.
  const pinnedFromBottom = useRef<number | null>(null);
  useEffect(() => setWindowSize(50), [selected]);

  const { data: threadPage } = trpc.conversations.messages.useQuery(
    { conversationId: selected ?? "", limit: windowSize },
    { enabled: !!selected, refetchInterval: 10000 }
  );
  const messages = threadPage?.messages;
  const totalMessages = threadPage?.total ?? 0;
  const hasOlder = totalMessages > (messages?.length ?? 0);

  // Declared below `messages` on purpose — it is what the effect watches.
  useEffect(() => {
    const list = messageList.current;
    if (!list) return;
    if (pinnedFromBottom.current === null) {
      list.scrollTop = list.scrollHeight;
      return;
    }
    list.scrollTop = list.scrollHeight - pinnedFromBottom.current;
    pinnedFromBottom.current = null;
  }, [messages]);
  const {
    data: pendingReplies,
    refetch: refetchPending,
    isFetching: pendingFetching,
    dataUpdatedAt: pendingUpdatedAt,
  } = trpc.pendingReplies.list.useQuery(undefined, {
    refetchInterval: 10000,
  });

  // The board already refreshes itself every ten seconds, but there is no way
  // to SEE that from the outside — so when a card looked wrong, the honest
  // question was "is this just old?" and there was nothing on the page that
  // answered it. Now the page says when it last checked, and there is a
  // button to check again, so a wrong card is known to be wrong rather than
  // suspected of being stale.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, []);
  const secondsSincePending = pendingUpdatedAt ? Math.max(0, Math.round((now - pendingUpdatedAt) / 1000)) : null;
  const updatedLabel =
    secondsSincePending === null
      ? "checking…"
      : secondsSincePending < 10
        ? "just now"
        : secondsSincePending < 60
          ? `${secondsSincePending}s ago`
          : `${Math.round(secondsSincePending / 60)}m ago`;

  // The people who asked something and never got an answer. Importing
  // brought their threads in but deliberately wrote nothing — this is the
  // second, separate press that says "now go and draft for them".
  const draftUnanswered = trpc.pendingReplies.draftUnanswered.useMutation({
    onSuccess: (result) => {
      if (result.drafted) toast.success(result.detail);
      else toast(result.detail);
      utils.pendingReplies.list.invalidate();
      utils.stats.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't reach the AI."),
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

  const needle = search.trim().toLowerCase();
  const matchesFilter = (c: { lastSenderType?: string | null; botPausedUntil?: string | Date | null }) => {
    if (filter === "mine") return isPaused(c.botPausedUntil);
    if (isPaused(c.botPausedUntil)) return filter === "all";
    if (filter === "needs") return c.lastSenderType === "customer";
    if (filter === "waiting") return !!c.lastSenderType && c.lastSenderType !== "customer";
    return true;
  };
  const shownConversations = (conversations ?? []).filter(
    (c) => matchesFilter(c) && (!needle || (c.senderName || "").toLowerCase().includes(needle))
  );

  const counts = {
    needs: (conversations ?? []).filter(
      (c) => !isPaused(c.botPausedUntil) && c.lastSenderType === "customer"
    ).length,
    waiting: (conversations ?? []).filter(
      (c) => !isPaused(c.botPausedUntil) && !!c.lastSenderType && c.lastSenderType !== "customer"
    ).length,
    mine: (conversations ?? []).filter((c) => isPaused(c.botPausedUntil)).length,
  };

  const active = conversations?.find((c) => c.conversationId === selected);
  const senderNameFor = (conversationId: string) =>
    conversations?.find((c) => c.conversationId === conversationId)?.senderName || "a customer";
  const avatarFor = (conversationId: string) =>
    conversations?.find((c) => c.conversationId === conversationId)?.avatarUrl ?? null;

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

      {/* Imported threads arrive with no draft, on purpose — importing writes
          to nobody. But some of those people asked something weeks ago and
          were missed, and they're the ones worth answering. Separate press,
          so it can never happen by accident. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-beige/20 px-4 py-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Someone asked a question and never got an answer? This writes a draft for each of
          them from the last fortnight — nothing sends, they all wait for your OK like any
          other. Older threads are left alone: they've usually been answered by hand somewhere
          this app can't see.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => draftUnanswered.mutate({ limit: 20, withinDays: 14 })}
          disabled={draftUnanswered.isPending}
        >
          <Sparkles
            className={cn("mr-2 h-3.5 w-3.5", draftUnanswered.isPending && "animate-pulse")}
          />
          {draftUnanswered.isPending ? "Drafting…" : "Draft the unanswered"}
        </Button>
      </div>

      {waiting > 0 && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="font-display text-lg tracking-[0.1em] text-charcoal">
              Waiting for your OK
              <span className="ml-2 text-sepia">({waiting})</span>
            </h2>
            <div className="flex items-center gap-2 text-xs text-sepia">
              <span>Updated {updatedLabel}</span>
              <button
                type="button"
                onClick={() => {
                  void refetchPending();
                  void utils.stats.invalidate();
                  void utils.conversations.list.invalidate();
                }}
                disabled={pendingFetching}
                className="rounded-full border border-line px-3 py-1 text-xs text-charcoal transition hover:bg-surface disabled:opacity-60"
              >
                {pendingFetching ? "Checking…" : "Refresh"}
              </button>
            </div>
          </div>
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {pendingReplies?.map((draft) => (
              <PendingReplyCard
                key={draft.id}
                draft={draft}
                senderName={senderNameFor(draft.conversationId)}
                avatarUrl={avatarFor(draft.conversationId)}
                platform={
                  conversations?.find((c) => c.conversationId === draft.conversationId)?.platform
                }
                onOpenThread={setSelected}
              />
            ))}
          </div>
        </section>
      )}

      <div ref={inboxRef} className="grid gap-6 md:grid-cols-[290px_1fr]">
        <div className="space-y-2">
          <h2 className="px-1 font-display text-sm tracking-[0.14em] text-muted-foreground">
            INBOX{conversations?.length ? ` (${conversations.length})` : ""}
          </h2>

          {/* Who's waiting on whom. The same split Messenger gives you, but
              worked out from the thread rather than typed in by hand. */}
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", `All${conversations?.length ? ` ${conversations.length}` : ""}`],
                ["needs", `Needs a reply${counts.needs ? ` ${counts.needs}` : ""}`],
                ["waiting", `Waiting on them${counts.waiting ? ` ${counts.waiting}` : ""}`],
                ["mine", `You're on it${counts.mine ? ` ${counts.mine}` : ""}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[0.68rem] transition-colors",
                  filter === key
                    ? "border-sepia bg-sepia/10 text-sepia"
                    : "border-border text-muted-foreground hover:border-sepia/60 hover:text-charcoal"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* A hundred threads is not a list you scroll on a phone. Without
              this, a customer you can see in Meta's inbox looks lost. */}
          {(conversations?.length ?? 0) > 8 && (
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name…"
              aria-label="Search conversations by name"
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-charcoal outline-none transition-colors focus:border-sepia"
            />
          )}

          {shownConversations.length ? (
            shownConversations.map((c) => (
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
                <Avatar name={c.senderName || "?"} src={c.avatarUrl} />
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
          ) : search.trim() ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">
              Nobody matching "{search.trim()}".
            </p>
          ) : filter !== "all" && conversations?.length ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">
              {filter === "needs"
                ? "Everyone's been answered."
                : filter === "waiting"
                  ? "Nobody's waiting on a reply from you."
                  : "You haven't taken over any threads."}
            </p>
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

        {threadPhoto && (
          <PhotoViewer
            urls={threadPhoto.urls}
            index={threadPhoto.index}
            onIndex={(i) => setThreadPhoto({ ...threadPhoto, index: i })}
            onClose={() => setThreadPhoto(null)}
            alt="Photo from the conversation"
          />
        )}

        <div>
          {!selected ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Pick a thread to read it.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4" ref={threadPanel}>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={active?.senderName || "Customer"} src={active?.avatarUrl} />
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

              {/* Its own scroll area, so "up" means further back in the
                  conversation rather than back out into the board. Capped in
                  viewport height so a long thread never pushes the reply box
                  off the bottom of a phone. */}
              <div
                ref={messageList}
                className="max-h-[60vh] space-y-3 overflow-y-auto overscroll-contain pr-1 sm:max-h-[65vh]"
              >
                {/* Older messages, on request. The thread opens on the most
                    recent fifty — the studio nearly always wants the bottom
                    of a conversation — and reaches further back only when
                    asked, so a customer with a year of history doesn't cost
                    a year of messages on every open. */}
                {hasOlder && (
                  <div className="flex flex-col items-center gap-1 pb-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // Remember the distance from the bottom so the
                        // messages already on screen stay put when fifty
                        // more land above them.
                        const list = messageList.current;
                        pinnedFromBottom.current = list
                          ? list.scrollHeight - list.scrollTop
                          : null;
                        setWindowSize((n) => n + 50);
                      }}
                    >
                      Load older messages
                    </Button>
                    <span className="text-[0.7rem] text-muted-foreground">
                      Showing the last {messages?.length ?? 0} of {totalMessages}
                    </span>
                  </div>
                )}
                {!hasOlder && totalMessages > 50 && (
                  <p className="pb-1 text-center text-[0.7rem] text-muted-foreground">
                    The start of the conversation — all {totalMessages} messages
                  </p>
                )}
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
                        {m.attachmentUrls.map((url, i) => (
                          <button
                            key={url}
                            type="button"
                            onClick={() => setThreadPhoto({ urls: m.attachmentUrls ?? [], index: i })}
                            className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <img
                              src={url}
                              alt="Reference photo"
                              className="h-32 w-32 rounded-lg object-cover"
                              loading="lazy"
                            />
                          </button>
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
