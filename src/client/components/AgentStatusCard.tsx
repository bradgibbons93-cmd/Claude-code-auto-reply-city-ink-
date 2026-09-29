import { Link } from "wouter";
import { Zap, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * Is the agent actually alive? One card, at the top, answering it honestly.
 *
 * This is the other half of the layout Brad liked, and it is the half that
 * earns its space. Every time this app has quietly stopped — a spent API
 * account, an expired token, a key made on the wrong workspace — the
 * dashboard went on looking completely normal, and he found out because the
 * drafts had gone quiet. The failure mode of this whole product is silence,
 * so silence is the thing the home screen has to break.
 *
 * `lastError` is the same field the failed-draft card reads, so the two
 * cannot disagree: if a draft failed for a reason, that reason is up here.
 * When there's nothing wrong it says so plainly and gets out of the way.
 */
export default function AgentStatusCard() {
  const { data: llm } = trpc.llm.status.useQuery(undefined, { refetchInterval: 30000 });

  // A stale error must not shout for ever. The agent clears it on the next
  // success, so anything older than the last half hour is history, not news.
  const recentError =
    llm?.lastError?.at && Date.now() - new Date(llm.lastError.at).getTime() < 30 * 60_000
      ? llm.lastError
      : null;

  const healthy = !!llm?.keySet && !recentError;

  return (
    <Link
      href="/settings#ai"
      className={cn(
        "group flex items-center gap-4 rounded-2xl border p-4 shadow-soft transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-lift",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        healthy ? "border-border bg-card" : "border-destructive/40 bg-destructive/5"
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          healthy ? "bg-beige/40 text-primary" : "bg-destructive/10 text-destructive"
        )}
      >
        {healthy ? (
          <Zap className="h-5 w-5" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-display text-base tracking-[0.06em] text-charcoal">
            AI replies
          </span>
          {healthy ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
              Live &amp; running
            </span>
          ) : (
            <span className="text-sm font-medium text-destructive">Not drafting</span>
          )}
        </span>

        {/* Wraps rather than truncates. The whole job of this card is to
            show the provider's actual sentence, and "the agent can't write
            anythi…" is the same dead end as no message at all. */}
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden">
          {healthy
            ? "Trained on your messages, your prices and the studio's own replies. Nothing sends without you."
            : /* The provider's own sentence, not a guess at it. Sending Brad
                 to a Test button to find out what the server already knew is
                 the mistake this whole app keeps having to unlearn. */
              (recentError?.message ??
                "No API key saved — the agent can't write anything until there is one.")}
        </span>
      </span>
    </Link>
  );
}
