import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function isPaused(until: string | Date | null | undefined) {
  return !!until && new Date(until) > new Date();
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

  return (
    <div className="space-y-8">
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
