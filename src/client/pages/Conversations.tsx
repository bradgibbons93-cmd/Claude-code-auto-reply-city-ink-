import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useSearch } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import PhotoViewer from "@/components/PhotoViewer";
import { MessagePhoto } from "@/components/MessagePhoto";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { awaitsStudio, cn, isPaused, previewLine, shortAgo } from "@/lib/utils";
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
  ArrowLeft,
  Search,
} from "lucide-react";

function PendingReplyCard({
  draft,
  senderName,
  avatarUrl,
  platform,
  onOpenThread,
  inThread = false,
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
  /**
   * Shown inside the open conversation, under the messages. The thread is
   * right there, so the card drops its own header and "They said" block and
   * shows the other versions as full cards you can read and tap — Brad:
   * "when I click into a message, it comes up with the auto replied message
   * and a few different options". Chips with the text in a hover title were
   * unreadable on a phone, which has no hover.
   */
  inThread?: boolean;
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

  /**
   * A follow-up isn't a reply to anything — the studio spoke last and heard
   * nothing back (or it's the aftercare check-in). Its id is made up, so the
   * lookup above always falls through to "their newest message", which can be
   * days older than the studio's last word. Headed THEY SAID, that read as the
   * thing being answered. Say what it is instead.
   */
  const followUp = draft.customerMessageId.startsWith("followup_aftercare_")
    ? "aftercare"
    : draft.customerMessageId.startsWith("followup_")
      ? "cold"
      : null;

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
  // A follow-up is old by design — that's why it exists — so the "check it
  // wasn't already answered" warning would be on every one of them.
  const isStale =
    !followUp && !!askedAt && Date.now() - askedAt.getTime() > 14 * 24 * 3600 * 1000;

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
      // The thread moves to Replied the moment it's answered.
      utils.conversations.list.invalidate();
      utils.conversations.messages.invalidate();
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
      utils.conversations.list.invalidate();
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

        {!inThread && (
          <>
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
              {followUp === "cold"
                ? "Follow-up · last from them"
                : followUp === "aftercare"
                  ? "Aftercare · last from them"
                  : "They said"}
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
                  <MessagePhoto
                    key={url}
                    src={url}
                    alt="Reference photo the customer sent"
                    className="h-28 w-28 rounded-lg border border-border object-cover"
                    onOpen={() => setPhoto(i)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

          </>
        )}

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.18em] text-sepia">
            <Sparkles className="h-3 w-3" />
            Draft reply
          </p>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            // Tall enough in a conversation to read the whole reply without
            // scrolling inside the box.
            className={inThread ? "min-h-40" : "min-h-24"}
            placeholder={draft.llmFailed ? `Write your reply to ${senderName}…` : undefined}
            aria-label={`Draft reply to ${senderName}`}
          />

          {/* In a conversation: every version as a card you can read and tap.
              Picking one loads it into the box above to edit — nothing sends
              until Approve is pressed. */}
          {inThread && options.length > 1 && (
            <div className="mt-3 space-y-2">
              <p className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
                Or pick another version
              </p>
              {options.map((option, index) => {
                const chosen = text === option.text;
                return (
                  <button
                    key={option.label + index}
                    type="button"
                    onClick={() => setText(option.text)}
                    aria-pressed={chosen}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                      chosen
                        ? "border-sepia bg-sepia/10"
                        : "border-border bg-surface hover:border-sepia/60"
                    )}
                  >
                    <span
                      className={cn(
                        "flex items-center gap-1.5 text-[0.62rem] uppercase tracking-[0.14em]",
                        chosen ? "text-sepia" : "text-muted-foreground"
                      )}
                    >
                      {chosen && <Check className="h-3 w-3" />}
                      {option.label}
                    </span>
                    <span className="mt-0.5 line-clamp-3 block text-xs text-charcoal">
                      {option.text}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Other ways of answering the same message. Picking one loads it
              above to edit — nothing sends until Approve is pressed. */}
          {!inThread && options.length > 1 && (
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

type InboxThread = {
  conversationId: string;
  senderName?: string | null;
  avatarUrl?: string | null;
  platform?: string | null;
  lastMessageAt?: string | Date | null;
  lastSenderType?: string | null;
  lastPreview?: string | null;
  lastPhotoCount?: number | null;
  botPausedUntil?: string | Date | null;
};

/**
 * One line of the inbox, laid out the way Meta's own inbox is: picture with
 * the app it came from in the corner, the name, the last thing said and how
 * long ago, and a dot when it's waiting on the studio.
 *
 * Brad, with a screen recording of Meta Business Suite: "I WANT IT BASICALLY
 * TO LOOK LIKE THE SAME ORDER AND EVERYTHING AS METAS INBOX". He works the two
 * side by side all day; a list that reads differently is a second thing to
 * learn and a second place to miss someone.
 */
function InboxRow({
  thread,
  hasDraft,
  isFollowUp,
  active,
  now,
  onOpen,
}: {
  thread: InboxThread;
  hasDraft: boolean;
  isFollowUp: boolean;
  active: boolean;
  now: number;
  onOpen: (conversationId: string) => void;
}) {
  const waiting = awaitsStudio(thread);
  const name = thread.senderName || "Unknown customer";
  return (
    <button
      type="button"
      onClick={() => onOpen(thread.conversationId)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors",
        active ? "bg-beige/25" : "hover:bg-beige/10"
      )}
    >
      <span className="relative shrink-0">
        <Avatar name={name} src={thread.avatarUrl} className="h-12 w-12 text-sm" />
        {/* Which inbox it's in, in the corner, as Meta does it. */}
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-background text-white",
            thread.platform === "instagram"
              ? "bg-gradient-to-tr from-[#f58529] via-[#dd2a7b] to-[#8134af]"
              : "bg-[#0a7cff]"
          )}
        >
          {thread.platform === "instagram" ? (
            <Instagram className="h-2.5 w-2.5" aria-label="Instagram" />
          ) : (
            <Facebook className="h-2.5 w-2.5" aria-label="Messenger" />
          )}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm text-charcoal",
            waiting && "font-semibold"
          )}
        >
          {name}
        </span>
        <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
          <span
            className={cn(
              "truncate",
              waiting ? "font-medium text-charcoal" : "text-muted-foreground"
            )}
          >
            {previewLine(thread)}
          </span>
          <span className="shrink-0 text-muted-foreground">
            {shortAgo(thread.lastMessageAt, now)}
          </span>
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        {hasDraft && (
          <span className="rounded-full bg-sepia/15 px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.12em] text-sepia">
            {isFollowUp ? "Follow-up" : "Draft ready"}
          </span>
        )}
        {isPaused(thread.botPausedUntil) && (
          <Badge className="border-sepia/40 bg-beige/30 text-[0.58rem] text-sepia">You</Badge>
        )}
        {waiting && <span className="h-2.5 w-2.5 rounded-full bg-destructive" aria-label="Needs a reply" />}
      </span>
    </button>
  );
}

function SectionHeading({
  title,
  count,
  note,
  action,
}: {
  title: string;
  count: number;
  note: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 px-2 pb-1 pt-4">
      <div className="min-w-0">
        <h2 className="font-display text-base tracking-[0.08em] text-charcoal">
          {title}
          <span className="ml-2 text-sm text-sepia">{count}</span>
        </h2>
        <p className="text-[0.7rem] text-muted-foreground">{note}</p>
      </div>
      {action}
    </div>
  );
}

// The Replied list runs to a couple of hundred. Meta loads it as you scroll;
// this shows a screenful and grows on request.
const REPLIED_PAGE = 40;

export default function Conversations() {
  // ?thread=… so a search result, a notification, or a link from the
  // dashboard opens the right conversation — and survives a refresh, which
  // a selection held only in React state never did.
  const [selected, setSelected] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("thread")
  );
  const [search, setSearch] = useState("");
  const [repliedShown, setRepliedShown] = useState(REPLIED_PAGE);
  const [, navigate] = useLocation();

  // The address follows the open thread, so a phone's own back gesture
  // closes the conversation instead of leaving the inbox.
  const routeSearch = useSearch();
  useEffect(() => {
    setSelected(new URLSearchParams(routeSearch).get("thread"));
  }, [routeSearch]);
  // Whether the open thread was reached from this list. If it was, Back is
  // one step back in history; if it came from a link, Back replaces it.
  const openedHere = useRef(false);
  const open = (conversationId: string) => {
    openedHere.current = true;
    navigate(`/messages?thread=${encodeURIComponent(conversationId)}`);
  };
  const close = () => {
    if (openedHere.current) {
      openedHere.current = false;
      window.history.back();
    } else {
      navigate("/messages", { replace: true });
    }
  };

  const utils = trpc.useUtils();

  const { data: conversations, refetch } = trpc.conversations.list.useQuery(undefined, {
    refetchInterval: 20000,
  });
  const {
    data: pendingReplies,
    refetch: refetchPending,
    isFetching: pendingFetching,
    dataUpdatedAt: pendingUpdatedAt,
  } = trpc.pendingReplies.list.useQuery(undefined, {
    refetchInterval: 10000,
  });

  // How far back the thread view is currently reading.
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
   * Opening a thread lands on the NEWEST message, and the message list
   * scrolls itself, so up means further back in the conversation — what a
   * messaging app does. (Brad: "I can't scroll up in the messages to see
   * previous.")
   */
  const threadPanel = useRef<HTMLDivElement>(null);
  const messageList = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected) return;
    threadPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  // The page says when it last checked, and there's a button to check
  // again, so a wrong card is known to be wrong rather than suspected of
  // being stale. The same clock keeps "7h" on each row honest.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, []);
  const secondsSincePending = pendingUpdatedAt
    ? Math.max(0, Math.round((now - pendingUpdatedAt) / 1000))
    : null;
  const updatedLabel =
    secondsSincePending === null
      ? "checking…"
      : secondsSincePending < 10
        ? "just now"
        : secondsSincePending < 60
          ? `${secondsSincePending}s ago`
          : `${Math.round(secondsSincePending / 60)}m ago`;

  // Anyone in the top section without a draft yet — the poll writes them
  // within a few minutes, and this does it now.
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

  // One live draft per person — the server already collapses them.
  const draftFor = new Map((pendingReplies ?? []).map((d) => [d.conversationId, d]));

  // A typed name searches the whole inbox, both sections, so anyone the
  // studio has already answered is still findable by name.
  const needle = search.trim().toLowerCase();
  const shown = (conversations ?? []).filter(
    (c) => !needle || (c.senderName || "").toLowerCase().includes(needle)
  );
  // `conversations.list` is newest-first already — Meta's order.
  const needsReply = shown.filter(awaitsStudio);
  const replied = shown.filter((c) => !awaitsStudio(c));
  const missingDrafts = needsReply.filter(
    (c) => !draftFor.has(c.conversationId) && !isPaused(c.botPausedUntil)
  ).length;

  const active = conversations?.find((c) => c.conversationId === selected);
  const activeDraft = selected ? draftFor.get(selected) : undefined;
  const activeName = active?.senderName || "Customer";

  const rowFor = (c: InboxThread) => {
    const draft = draftFor.get(c.conversationId);
    return (
      <InboxRow
        key={c.conversationId}
        thread={c}
        hasDraft={!!draft}
        isFollowUp={!!draft?.customerMessageId.startsWith("followup_")}
        active={selected === c.conversationId}
        now={now}
        onOpen={open}
      />
    );
  };

  return (
    <div className="grid gap-6 md:grid-cols-[360px_1fr]">
      {/* The list. On a phone it steps aside while a conversation is open,
          the way every messaging app does. */}
      <section className={cn("min-w-0", selected && "hidden md:block")}>
        <div className="flex items-center justify-between gap-3 px-2">
          <h1 className="font-display text-2xl tracking-[0.06em] text-charcoal">Inbox</h1>
          <div className="flex items-center gap-2 text-[0.7rem] text-sepia">
            <span>Updated {updatedLabel}</span>
            <button
              type="button"
              onClick={() => {
                void refetchPending();
                void refetch();
                void utils.stats.invalidate();
              }}
              disabled={pendingFetching}
              className="rounded-full border border-line px-3 py-1 text-xs text-charcoal transition hover:bg-surface disabled:opacity-60"
            >
              {pendingFetching ? "Checking…" : "Refresh"}
            </button>
          </div>
        </div>

        <label className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 focus-within:border-sepia">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            aria-label="Search conversations by name"
            className="w-full bg-transparent text-sm text-charcoal outline-none"
          />
        </label>

        {!conversations ? (
          <div className="mt-4 space-y-2 px-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-14 animate-shimmer rounded-xl bg-beige/20" />
            ))}
          </div>
        ) : !conversations.length ? (
          <Card className="mt-4">
            <CardContent className="pt-6">
              <StampBadge className="mx-auto mb-4 h-24 w-24 text-sepia opacity-70" />
              <p className="text-sm text-muted-foreground">
                No messages yet. Connect the Page in Settings, then send your studio a test
                message.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <SectionHeading
              title="Needs a reply"
              count={needsReply.length}
              note="They wrote last. Newest at the top, same as Meta."
              action={
                missingDrafts > 0 ? (
                  <button
                    type="button"
                    onClick={() => draftUnanswered.mutate({ limit: 10, withinDays: 7 })}
                    disabled={draftUnanswered.isPending}
                    className="flex shrink-0 items-center gap-1 rounded-full border border-sepia/50 px-2.5 py-1 text-[0.68rem] text-sepia transition hover:bg-sepia/10 disabled:opacity-60"
                  >
                    <Sparkles
                      className={cn("h-3 w-3", draftUnanswered.isPending && "animate-pulse")}
                    />
                    {draftUnanswered.isPending
                      ? "Drafting…"
                      : `Draft ${missingDrafts} now`}
                  </button>
                ) : undefined
              }
            />
            <div className="border-b border-border pb-3">
              {needsReply.length ? (
                needsReply.map(rowFor)
              ) : (
                <p className="px-2 py-4 text-sm text-muted-foreground">
                  {needle ? `Nobody here matching "${search.trim()}".` : "Everyone's been answered. 🙌"}
                </p>
              )}
            </div>

            <SectionHeading
              title="Replied"
              count={replied.length}
              note="You've answered, or it's over a week old and Meta won't let the app reply."
            />
            <div className="opacity-90">
              {replied.length ? (
                replied.slice(0, needle ? replied.length : repliedShown).map(rowFor)
              ) : (
                <p className="px-2 py-4 text-sm text-muted-foreground">
                  {needle ? `Nobody here matching "${search.trim()}".` : "Nothing here yet."}
                </p>
              )}
              {!needle && replied.length > repliedShown && (
                <div className="px-2 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setRepliedShown((n) => n + REPLIED_PAGE)}
                  >
                    Show more ({replied.length - repliedShown} older)
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {threadPhoto && (
        <PhotoViewer
          urls={threadPhoto.urls}
          index={threadPhoto.index}
          onIndex={(i) => setThreadPhoto({ ...threadPhoto, index: i })}
          onClose={() => setThreadPhoto(null)}
          alt="Photo from the conversation"
        />
      )}

      {/* The open conversation: the thread, then the drafted reply with its
          other versions underneath. */}
      <section className={cn("min-w-0", !selected && "hidden md:block")}>
        {!selected ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Tap someone on the left to open the conversation and their drafted reply.
              </p>
            </CardContent>
          </Card>
        ) : (
          // scroll-mt clears the sticky header, which otherwise sat on top
          // of the person's name when the thread scrolled into view.
          <div className="scroll-mt-28 space-y-4" ref={threadPanel}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="-ml-1 flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-sm text-sepia hover:bg-beige/20 md:hidden"
                  aria-label="Back to the inbox"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Inbox
                </button>
                <Avatar name={activeName} src={active?.avatarUrl} />
                <div className="min-w-0">
                  <h2 className="truncate font-display text-lg tracking-[0.06em] text-charcoal">
                    {activeName}
                  </h2>
                  <p className="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
                    {active?.platform === "instagram" ? (
                      <Instagram className="h-3 w-3" />
                    ) : (
                      <Facebook className="h-3 w-3" />
                    )}
                    {active?.platform === "instagram" ? "Instagram" : "Messenger"}
                    {active?.lastMessageAt && <> · {shortAgo(active.lastMessageAt, now)}</>}
                  </p>
                </div>
              </div>
              {isPaused(active?.botPausedUntil) ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => resume.mutate({ conversationId: selected })}
                >
                  Hand back
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
                conversation. Shorter when a draft sits under it, so the
                reply is on the same phone screen as what it's answering. */}
            <div
              ref={messageList}
              className={cn(
                "space-y-3 overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface/40 p-3",
                activeDraft ? "max-h-[42vh] sm:max-h-[50vh]" : "max-h-[65vh]"
              )}
            >
              {hasOlder && (
                <div className="flex flex-col items-center gap-1 pb-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const list = messageList.current;
                      pinnedFromBottom.current = list ? list.scrollHeight - list.scrollTop : null;
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
                        <MessagePhoto
                          key={url}
                          src={url}
                          alt="Reference photo"
                          className="h-32 w-32 rounded-lg object-cover"
                          onOpen={() => setThreadPhoto({ urls: m.attachmentUrls ?? [], index: i })}
                        />
                      ))}
                    </div>
                  )}
                  <p
                    className={cn(
                      "mt-1 text-[0.65rem]",
                      m.senderType === "customer"
                        ? "text-muted-foreground"
                        : "text-primary-foreground/60"
                    )}
                  >
                    {m.senderType === "manual"
                      ? "Studio (typed)"
                      : m.senderType === "bot"
                        ? "Sent by agent"
                        : "Customer"}
                    {m.createdAt && <> · {format(new Date(m.createdAt), "d MMM, h:mm a")}</>}
                  </p>
                </div>
              ))}
            </div>

            {activeDraft ? (
              <PendingReplyCard
                key={activeDraft.id}
                draft={activeDraft}
                senderName={activeName}
                avatarUrl={active?.avatarUrl}
                platform={active?.platform}
                onOpenThread={open}
                inThread
              />
            ) : active && awaitsStudio(active) ? (
              <Card>
                <CardContent className="flex flex-col items-start gap-3 pt-6">
                  <p className="text-sm text-muted-foreground">
                    No draft yet — the agent writes one within a few minutes of a message
                    landing.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => draftUnanswered.mutate({ limit: 10, withinDays: 7 })}
                    disabled={draftUnanswered.isPending}
                  >
                    <Sparkles
                      className={cn("mr-2 h-3.5 w-3.5", draftUnanswered.isPending && "animate-pulse")}
                    />
                    {draftUnanswered.isPending ? "Drafting…" : "Draft it now"}
                  </Button>
                </CardContent>
              </Card>
            ) : active ? (
              <p className="px-1 text-center text-xs text-muted-foreground">
                {active.lastSenderType === "customer"
                  ? "Over a week old — Meta won't let the app reply. Answer from the Instagram or Messenger app if it still needs one."
                  : "You've replied — nothing waiting on you here."}
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
