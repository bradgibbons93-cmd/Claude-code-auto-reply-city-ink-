import { Link } from "wouter";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSession, firstName, initials } from "@/lib/session";
import { isUnanswered } from "@/lib/utils";
import ReplyDeck from "@/components/home/ReplyDeck";
import { ChairTimeline, TodayTiles } from "@/components/home/StudioToday";
import { BackToClassic } from "@/components/home/HomeLayoutSwitch";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Is the agent drafting? The same honest answer AgentStatusCard gave, as a
 * pill in the corner when all is well — and as a sentence across the top when
 * it isn't, because the failure mode of this app is silence and a quiet deck
 * looks exactly like a slow day.
 */
function useAgentHealth() {
  const { data: llm } = trpc.llm.status.useQuery(undefined, { refetchInterval: 30000 });
  const recentError =
    llm?.lastError?.at && Date.now() - new Date(llm.lastError.at).getTime() < 30 * 60_000
      ? llm.lastError
      : null;
  return {
    known: !!llm,
    healthy: !!llm?.keySet && !recentError,
    reason: recentError?.message ?? "No API key saved — the agent can't write anything until there is one.",
  };
}

/**
 * Home. Brad's brief, in order: the auto replies first, then the bookings,
 * then the posting — simple, animated, a hint of tattoo. Everything here is
 * one tap from the thing it describes; the rest of the app is in the menu.
 */
export default function Home() {
  const { studio, user } = useSession();
  const agent = useAgentHealth();
  const { data: dash } = trpc.dashboard.useQuery(undefined, { refetchInterval: 30000 });
  const { data: drafts } = trpc.pendingReplies.list.useQuery(undefined, { refetchInterval: 10000 });
  const { data: threads } = trpc.conversations.list.useQuery(undefined, { refetchInterval: 20000 });

  // People still waiting who have no draft on the deck — a failed draft, a
  // thread taken over by hand, an import. The deck can't show them, so say
  // how many there are rather than let them fall out of sight.
  const drafted = new Set((drafts ?? []).map((d) => d.conversationId));
  const waitingWithoutDraft = (threads ?? []).filter((t) => isUnanswered(t) && !drafted.has(t.conversationId)).length;

  const name = firstName(user?.name);
  const messagesToday = dash?.todayMessages;

  return (
    <div className="relative mx-auto max-w-5xl">
      {/* Behind the top of the page: the studio's own banner photo, if it
          has one (onboarding asks for it — this is where it shows), under a
          flash sheet drawn in the studio's accent. */}
      <div aria-hidden="true" className="home-flash-fade pointer-events-none absolute -inset-x-6 -top-6 h-[520px] overflow-hidden">
        {studio?.coverUrl && (
          <>
            <img src={studio.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />
            <div className="absolute inset-0 bg-background/55" />
          </>
        )}
        <div className="home-flash relative h-full w-full" />
      </div>

      <div className="relative">
        <div className="flex items-center gap-3">
          {studio?.logoUrl ? (
            <img
              src={studio.logoUrl}
              alt=""
              className="h-11 w-11 shrink-0 rounded-full border border-sepia/60 bg-card object-contain p-1"
            />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-sepia/60 bg-card font-display text-lg uppercase text-sepia">
              {initials(studio?.name)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-charcoal">{studio?.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {greeting()}
              {name ? `, ${name}` : ""}
            </p>
          </div>
          {agent.known && (
            <Link
              href="/settings#ai"
              className={
                agent.healthy
                  ? "inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border border-sepia/45 bg-card/80 px-3.5 text-xs font-semibold text-charcoal backdrop-blur"
                  : "inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border border-destructive/50 bg-destructive/10 px-3.5 text-xs font-semibold text-destructive"
              }
            >
              <span
                className={agent.healthy ? "h-2 w-2 animate-glow-pulse rounded-full bg-primary" : "h-2 w-2 rounded-full bg-destructive"}
              />
              {agent.healthy ? "AI replies live" : "Not drafting"}
            </Link>
          )}
        </div>

        {agent.known && !agent.healthy && (
          <Link
            href="/settings#ai"
            className="mt-3 flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{agent.reason}</span>
          </Link>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start">
          <div className="space-y-3">
            <ReplyDeck messagesToday={messagesToday} />
            {waitingWithoutDraft > 0 && (
              <Link
                href="/messages"
                className="flex min-h-[44px] items-center justify-between gap-3 rounded-2xl border border-border bg-card/70 px-4 text-sm text-charcoal backdrop-blur hover:border-sepia/50"
              >
                <span>
                  {waitingWithoutDraft} more {waitingWithoutDraft === 1 ? "person is" : "people are"} waiting without a draft
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-sepia" />
              </Link>
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-[0.95rem] font-semibold text-charcoal lg:mt-1">Today at the studio</h2>
            <TodayTiles />
            <ChairTimeline />
          </div>
        </div>
        <div className="mt-6">
          <BackToClassic />
        </div>
      </div>
    </div>
  );
}
