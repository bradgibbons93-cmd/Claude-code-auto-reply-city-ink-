import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocation } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Facebook, Instagram, PenLine, Send, MessageSquare } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/Avatar";
import { queueSend, cancelSend, useQueuedSends } from "./sendQueue";
import { Art } from "./Art";

type Draft = inferRouterOutputs<AppRouter>["pendingReplies"]["list"][number];
type Thread = inferRouterOutputs<AppRouter>["conversations"]["list"][number];

/** How long a swiped reply waits for an Undo before it goes to Meta. */
export const UNDO_MS = 5000;
/** How far a card has to travel before letting go commits the swipe. */
const COMMIT_PX = 90;
const FORTNIGHT_MS = 14 * 24 * 3600 * 1000;

/**
 * What a draft needs before it can go with one swipe.
 *
 * The inbox's own card warns about each of these in words. A deck you can
 * flick through quickly has to be stricter: anything that asks a person to
 * read first — something personal, a draft the AI never finished, a send
 * Meta already refused, a message weeks old — opens the conversation instead
 * of sending.
 */
function blocker(draft: Draft, askedAt: Date | null): string | null {
  if (draft.isSensitive) return "Something personal — reply yourself";
  if (draft.llmFailed || !draft.draftText.trim()) return "No draft — write this one yourself";
  if (draft.sendError) return "This didn't send last time";
  if (askedAt && Date.now() - askedAt.getTime() > FORTNIGHT_MS)
    return `From ${format(askedAt, "d MMM")} — check the chat first`;
  return null;
}

/**
 * The customer's message this draft answers, checked to really be theirs.
 * Same rule as the inbox card (see the Rebecca note in Conversations.tsx):
 * never put the studio's own words under "They said".
 */
function useAsked(draft: Draft | undefined) {
  const { data } = trpc.conversations.messages.useQuery(
    { conversationId: draft?.conversationId ?? "" },
    { enabled: !!draft }
  );
  if (!draft) return { text: null as string | null, at: null as Date | null, followUp: null as string | null };
  const thread = data?.messages ?? [];
  const asked =
    thread.find((m) => m.messageId === draft.customerMessageId && m.senderType === "customer") ??
    [...thread].reverse().find((m) => m.senderType === "customer");
  const followUp = draft.customerMessageId.startsWith("followup_aftercare_")
    ? "Aftercare check-in"
    : draft.customerMessageId.startsWith("followup_")
      ? "Follow-up"
      : null;
  return {
    text: asked?.content?.trim() || (draft.photoUrls?.length ? "Sent a photo" : null),
    at: followUp ? null : asked?.createdAt ? new Date(asked.createdAt) : null,
    followUp,
  };
}

export default function ReplyDeck({ messagesToday }: { messagesToday?: number | null }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: drafts, isLoading } = trpc.pendingReplies.list.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const { data: threads } = trpc.conversations.list.useQuery(undefined, { refetchInterval: 20000 });
  const queued = useQueuedSends();

  const deck = (drafts ?? []).filter((d) => !queued.has(d.id));
  const top = deck[0];
  const asked = useAsked(top);
  const blockedBy = top ? blocker(top, asked.at) : null;

  const threadFor = (d: Draft): Thread | undefined =>
    threads?.find((t) => t.conversationId === d.conversationId);
  const nameFor = (d: Draft) => threadFor(d)?.senderName || "this customer";

  // The drag. `x` follows the finger; `leaving` flies the card off once a
  // swipe is committed, before the deck moves up.
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState<{ id: number; dir: 1 | -1 } | null>(null);
  // The top card leans right once when the page opens, to show it swipes.
  // Once: a hint on every new card would be noise by the third.
  const [peeked, setPeeked] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);

  const openThread = (d: Draft) => navigate(`/messages?thread=${encodeURIComponent(d.conversationId)}`);

  const send = (d: Draft) => {
    const name = nameFor(d);
    queueSend(d.id, UNDO_MS, async () => {
      try {
        await utils.client.pendingReplies.approve.mutate({ id: d.id, editedText: d.draftText });
        toast.success(`Sent to ${name}`);
      } catch (error) {
        // The server puts a refused reply back on the board with the reason.
        toast.error((error as Error).message || `Couldn't send that reply to ${name}.`, {
          duration: 10000,
        });
      } finally {
        await Promise.all([
          utils.pendingReplies.list.invalidate(),
          utils.conversations.list.invalidate(),
        ]);
      }
    });
    toast(`Sending to ${name}…`, {
      description: "Changed your mind? Undo keeps it as a draft.",
      duration: UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          if (cancelSend(d.id)) toast("Kept as a draft — nothing was sent");
        },
      },
    });
  };

  const commit = (d: Draft, dir: 1 | -1) => {
    if (dir === 1 && blockedBy) {
      // Not one to send blind: spring back and open the chat instead.
      setX(0);
      openThread(d);
      return;
    }
    setLeaving({ id: d.id, dir });
    window.setTimeout(() => {
      setLeaving(null);
      setX(0);
      if (dir === 1) send(d);
      else openThread(d);
    }, 260);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!top || leaving) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    setX(e.clientX - start.current.x);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (!start.current || !top) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    start.current = null;
    setDragging(false);
    if (dx > COMMIT_PX) commit(top, 1);
    else if (dx < -COMMIT_PX) commit(top, -1);
    else {
      setX(0);
      // A tap, not a drag: read the whole conversation.
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) openThread(top);
    }
  };
  const onPointerCancel = () => {
    start.current = null;
    setDragging(false);
    setX(0);
  };

  const lean = Math.max(-1, Math.min(1, x / COMMIT_PX));
  const count = deck.length;

  return (
    <section
      aria-label="Replies waiting for your OK"
      className="relative rounded-[30px] border border-sepia/25 bg-card/85 p-4 shadow-lift backdrop-blur-md sm:p-5"
    >
      <span
        aria-hidden="true"
        className="home-glow pointer-events-none absolute -top-8 right-0 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgb(var(--c-accent-strong)/0.45),transparent_66%)]"
      />
      <Art
        src="/home/reply.webp"
        className="home-bob absolute -top-5 right-1 h-[108px] w-[104px] drop-shadow-[0_12px_18px_rgb(0_0_0/0.55)] sm:right-3"
      />

      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-sepia">
        AI replies{messagesToday != null ? ` · ${messagesToday} ${messagesToday === 1 ? "DM" : "DMs"} today` : ""}
      </p>
      <h1 className="mt-1 max-w-[70%] font-display text-[2.6rem] font-medium uppercase leading-[0.95] tracking-[0.01em] text-charcoal">
        {isLoading ? "Loading…" : count ? `${count} ready to send` : "All caught up"}
      </h1>
      <p className="mt-1.5 max-w-[70%] text-[0.82rem] text-muted-foreground">
        {count
          ? "Swipe right to send · left to edit"
          : "New replies land here the moment Runnit writes them."}
      </p>

      {/* The deck. Only the top card moves; the two behind it are there so
          it reads as a pile of work, not a single message. */}
      <div className="relative mt-4 h-[222px] select-none">
        {isLoading && <div className="shimmer absolute inset-x-0 top-0 h-[198px] animate-shimmer rounded-[22px] bg-beige/20" />}

        {!isLoading && !count && (
          <div className="absolute inset-x-0 top-0 flex h-[198px] flex-col items-center justify-center gap-3 rounded-[22px] border border-dashed border-border px-6 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing waiting for your OK. Every DM that comes in gets a reply drafted here in the studio's
              voice.
            </p>
            <button
              type="button"
              onClick={() => navigate("/messages")}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border px-4 text-sm text-charcoal transition-colors hover:border-sepia"
            >
              <MessageSquare className="h-4 w-4" /> Open messages
            </button>
          </div>
        )}

        {deck
          .slice(0, 3)
          .map((draft, depth) => {
            const isTop = depth === 0;
            const flying = leaving?.id === draft.id ? leaving.dir : 0;
            const dx = flying ? flying * 520 : isTop ? x : 0;
            const style = isTop
              ? {
                  transform: `translateX(${dx}px) rotate(${(dx / 24).toFixed(2)}deg)`,
                  opacity: flying ? 0 : 1,
                  transition: dragging ? "none" : "transform 380ms cubic-bezier(.2,.8,.2,1), opacity 260ms ease",
                  zIndex: 3,
                }
              : {
                  transform: `translateY(${depth * 12}px) scale(${1 - depth * 0.05})`,
                  opacity: depth === 1 ? 0.8 : 0.45,
                  transition: "transform 380ms cubic-bezier(.2,.8,.2,1), opacity 300ms ease",
                  zIndex: 3 - depth,
                };
            const thread = threadFor(draft);
            const name = thread?.senderName || "Customer";
            return (
              <article
                key={draft.id}
                aria-hidden={!isTop}
                aria-label={isTop ? `Reply to ${name}` : undefined}
                onPointerDown={isTop ? onPointerDown : undefined}
                onPointerMove={isTop ? onPointerMove : undefined}
                onPointerUp={isTop ? onPointerUp : undefined}
                onPointerCancel={isTop ? onPointerCancel : undefined}
                style={style}
                className={cn(
                  "absolute inset-x-0 top-0 flex h-[198px] origin-bottom flex-col gap-2 overflow-hidden rounded-[22px] border bg-elevated px-4 py-3.5 shadow-soft",
                  isTop ? "cursor-grab touch-pan-y border-sepia/35 active:cursor-grabbing" : "border-border",
                  isTop && !peeked && !x && !leaving && !dragging && "home-peek"
                )}
                onAnimationEnd={isTop ? () => setPeeked(true) : undefined}
              >
                <div className="flex items-center gap-2.5">
                  <Avatar name={name} src={thread?.avatarUrl} className="h-8 w-8" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <b className="truncate text-[0.95rem] font-semibold text-charcoal">{name}</b>
                      {thread?.platform === "instagram" ? (
                        <Instagram className="h-3 w-3 shrink-0 text-sepia" aria-label="Instagram" />
                      ) : (
                        <Facebook className="h-3 w-3 shrink-0 text-sepia" aria-label="Messenger" />
                      )}
                    </span>
                    {isTop && (asked.at || draft.createdAt) && (
                      <span className="block text-xs text-muted-foreground">
                        {asked.followUp ??
                          formatDistanceToNow(new Date((asked.at ?? draft.createdAt) as Date), { addSuffix: true })}
                      </span>
                    )}
                  </span>
                </div>

                {isTop && blockedBy ? (
                  <p className="flex items-center gap-1.5 rounded-lg bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {blockedBy}
                  </p>
                ) : (
                  isTop &&
                  asked.text && (
                    <p className="line-clamp-2 text-[0.82rem] leading-snug text-muted-foreground">
                      {asked.followUp ? "Last from them: " : ""}“{asked.text}”
                    </p>
                  )
                )}

                <div className="flex items-center gap-2" aria-hidden="true">
                  <span className="h-[5px] w-[5px] rotate-45 bg-sepia" />
                  <span className="text-[0.6rem] font-semibold uppercase tracking-[0.24em] text-sepia">
                    Runnit's reply
                  </span>
                  <span className="h-px flex-1 bg-sepia/35" />
                </div>
                <p className="line-clamp-3 text-[0.92rem] leading-snug text-charcoal">
                  {draft.draftText || "—"}
                </p>

                {isTop && (
                  <>
                    <span
                      aria-hidden="true"
                      style={{ opacity: Math.max(0, lean) }}
                      className="pointer-events-none absolute right-4 top-3 rotate-[10deg] rounded-lg border-[3px] border-sepia bg-elevated px-2.5 font-display text-2xl uppercase tracking-[0.06em] text-sepia"
                    >
                      {blockedBy ? "Open" : "Send"}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{ opacity: Math.max(0, -lean) }}
                      className="pointer-events-none absolute right-4 top-3 -rotate-[8deg] rounded-lg border-[3px] border-charcoal bg-elevated px-2.5 font-display text-2xl uppercase tracking-[0.06em] text-charcoal"
                    >
                      Edit
                    </span>
                  </>
                )}
              </article>
            );
          })
          .reverse()}
      </div>

      {!!count && top && (
        <div className="mt-1 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => commit(top, -1)}
            aria-label={`Edit the reply to ${nameFor(top)}`}
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-charcoal transition-colors hover:border-sepia"
          >
            <PenLine className="h-5 w-5" />
          </button>
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            1 of {count}
            <ArrowRight className="home-nudge h-4 w-4 text-sepia" aria-hidden="true" />
          </span>
          <button
            type="button"
            onClick={() => commit(top, 1)}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-primary pl-4 pr-5 text-[0.95rem] font-semibold text-primary-foreground shadow-glow transition-transform active:scale-95"
          >
            {blockedBy ? <MessageSquare className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {blockedBy ? "Open chat" : "Send"}
          </button>
        </div>
      )}
    </section>
  );
}
