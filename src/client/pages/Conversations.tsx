import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function isPaused(until: string | Date | null | undefined) {
  return !!until && new Date(until) > new Date();
}

function PendingReplyCard({
  draft,
  senderName,
}: {
  draft: { id: number; draftText: string; createdAt: string | Date | null };
  senderName: string;
}) {
  const utils = trpc.useUtils();
  const [text, setText] = useState(draft.draftText);

  const approve = trpc.pendingReplies.approve.useMutation({
    onSuccess: () => {
      toast.success("Sent");
      utils.pendingReplies.list.invalidate();
    },
    onError: () => toast.error("Couldn't send that reply."),
  });
  const reject = trpc.pendingReplies.reject.useMutation({
    onSuccess: () => {
      toast("Discarded — nothing was sent");
      utils.pendingReplies.list.invalidate();
    },
  });

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>To {senderName}</span>
          {draft.createdAt && <span>{formatDistanceToNow(new Date(draft.createdAt), { addSuffix: true })}</span>}
        </div>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-20" />
        <div className="flex gap-2">
          <Button
            onClick={() => approve.mutate({ id: draft.id, editedText: text })}
            disabled={approve.isPending || reject.isPending}
          >
            {approve.isPending ? "Sending…" : "Approve & send"}
          </Button>
          <Button
            variant="outline"
            onClick={() => reject.mutate({ id: draft.id })}
            disabled={approve.isPending || reject.isPending}
          >
            Discard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Conversations() {
  const [selected, setSelected] = useState<string | null>(null);

  const { data: stats } = trpc.stats.useQuery();
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

  return (
    <div className="space-y-8">
      {!!pendingReplies?.length && (
        <div className="space-y-3">
          <h2 className="font-serif text-xl text-amber-400">
            Waiting for your OK ({pendingReplies.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {pendingReplies.map((draft) => (
              <PendingReplyCard
                key={draft.id}
                draft={draft}
                senderName={senderNameFor(draft.conversationId)}
              />
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Threads", stats?.conversations],
          ["Messages", stats?.messages],
          ["Agent replies", stats?.botReplies],
          ["Posts queued", stats?.pendingPosts],
        ].map(([label, value]) => (
          <Card key={label as string} className="border-amber-500/15">
            <CardContent className="pt-6">
              <p className="font-serif text-3xl text-amber-400">{value ?? "—"}</p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {conversations?.length ? (
            conversations.map((c) => (
              <button
                key={c.conversationId}
                onClick={() => setSelected(c.conversationId)}
                className={cn(
                  "w-full rounded-lg border p-3 text-left transition-colors",
                  selected === c.conversationId
                    ? "border-amber-500/50 bg-amber-500/5"
                    : "border-amber-500/15 hover:border-amber-500/30"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm">{c.senderName || "Unknown customer"}</span>
                  {isPaused(c.botPausedUntil) && (
                    <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-400">
                      You
                    </Badge>
                  )}
                </div>
                {c.lastMessageAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true })}
                  </p>
                )}
              </button>
            ))
          ) : (
            <Card className="border-amber-500/15">
              <CardContent className="pt-6">
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
            <Card className="border-amber-500/15">
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">Pick a thread to read it.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-serif text-xl">{active?.senderName || "Customer"}</h2>
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
                      "max-w-[85%] rounded-lg px-4 py-2 text-sm",
                      m.senderType === "customer"
                        ? "border border-amber-500/15 bg-card"
                        : "ml-auto bg-amber-500/10 text-amber-100"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {m.senderType === "manual" ? "Studio (typed)" : m.senderType}
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
