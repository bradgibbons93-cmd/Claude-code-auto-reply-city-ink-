import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import {
  MessageCircle,
  CalendarDays,
  Clock,
  PenLine,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Facebook,
  Instagram,
  CalendarCheck,
  Globe,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import LiveFeed from "@/components/LiveFeed";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { useReveal } from "@/lib/useReveal";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Tiny inline sparkline. No chart library for seven numbers. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const range = max - min || 1;
  const path = points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * 60;
      const y = 20 - ((value - min) / range) * 18;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox="0 0 60 22" className="h-6 w-16 overflow-visible" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
  deltaPct,
  note,
  series,
  loading,
}: {
  icon: typeof MessageCircle;
  label: string;
  value: number | null | undefined;
  suffix?: string;
  deltaPct?: number | null;
  note?: string;
  series?: number[];
  loading?: boolean;
}) {
  const up = (deltaPct ?? 0) >= 0;
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="pt-6">
        {/* Icon on its own row above the text. Beside it, a 44px circle plus
            its gap left the label too narrow at four across and "Avg approval
            time" wrapped onto three lines; in the corner it overlapped. */}
        <div>
          <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-beige/30 text-sepia">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            {loading ? (
              <div className="shimmer mt-1.5 h-8 w-16 animate-shimmer rounded-md bg-beige/25" />
            ) : (
              <p className="mt-0.5 font-display text-3xl leading-tight text-charcoal tabular-nums">
                {value ?? 0}
                {suffix && <span className="ml-1 text-base">{suffix}</span>}
              </p>
            )}
            <div className="mt-1 flex items-center justify-between gap-2">
              {deltaPct != null ? (
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs",
                    up ? "text-success" : "text-destructive"
                  )}
                >
                  {up ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {Math.abs(deltaPct)}% vs yesterday
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{note ?? ""}</span>
              )}
              {!!series?.length && (
                <span className={up ? "text-success" : "text-sepia"}>
                  <Sparkline points={series} />
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
      {/* A gold hairline that catches the eye as the card lifts. */}
      <span className="pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-sepia/40 to-transparent" />
    </Card>
  );
}

function IntegrationRow({
  icon: Icon,
  label,
  connected,
  tint,
}: {
  icon: typeof Facebook;
  label: string;
  connected: boolean;
  tint: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", tint)}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="flex-1 text-sm text-charcoal">{label}</span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-xs",
          connected ? "text-success" : "text-muted-foreground"
        )}
      >
        {connected ? "Connected" : "Not set up"}
        {connected && <CheckCircle2 className="h-3.5 w-3.5" />}
      </span>
    </div>
  );
}

export default function Dashboard() {
  const lowerRef = useReveal<HTMLDivElement>();

  const { data: dash, isLoading } = trpc.dashboard.useQuery(undefined, { refetchInterval: 15000 });
  const { data: pending } = trpc.pendingReplies.list.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const { data: conversations } = trpc.conversations.list.useQuery(undefined, {
    refetchInterval: 20000,
  });
  const { data: bookings } = trpc.calendar.upcoming.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: fb } = trpc.config.facebook.useQuery();
  const { data: timely } = trpc.config.timely.useQuery();

  const series = dash?.series.map((point) => point.count) ?? [];
  const nameFor = (conversationId: string) =>
    conversations?.find((c) => c.conversationId === conversationId)?.senderName ?? "a customer";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl tracking-[0.06em] text-charcoal">
            {greeting()}, Brad 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending?.length
              ? `${pending.length} ${pending.length === 1 ? "reply is" : "replies are"} waiting on you.`
              : "Nothing waiting on you right now."}
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-success/40 bg-success/10 px-4 py-1.5 text-xs text-success">
          <span className="live-dot" />
          Automation active
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={MessageCircle}
              label="Messages today"
              value={dash?.todayMessages}
              deltaPct={dash?.messagesDeltaPct}
              series={series}
              loading={isLoading}
            />
            <StatCard
              icon={CalendarDays}
              label="New bookings"
              value={dash?.newBookings}
              note="Handed to you in 24h"
              loading={isLoading}
            />
            <StatCard
              icon={Clock}
              label="Avg approval time"
              value={dash?.avgResponseMinutes}
              suffix="min"
              note={dash?.avgResponseMinutes == null ? "No approvals yet" : "From draft to sent"}
              loading={isLoading}
            />
            <StatCard
              icon={PenLine}
              label="Drafts waiting"
              value={pending?.length}
              note="Requires your approval"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base tracking-[0.06em] text-charcoal">
                      Messenger Inbox
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      All incoming Facebook messages
                    </p>
                  </div>
                  <Link
                    href="/messages"
                    className="text-xs text-sepia underline-offset-2 hover:underline"
                  >
                    View all
                  </Link>
                </div>

                <div className="mt-4 divide-y divide-border">
                  {conversations?.length ? (
                    conversations.slice(0, 5).map((c) => (
                      <Link
                        key={c.conversationId}
                        href="/messages"
                        className="flex items-center gap-3 py-3 transition-colors hover:bg-beige/10"
                      >
                        <Avatar name={c.senderName || "?"} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-charcoal">
                            {c.senderName || "Unknown customer"}
                          </p>
                          {c.bookingDates && (
                            <p className="truncate text-xs text-muted-foreground">
                              Wants {c.bookingDates}
                            </p>
                          )}
                        </div>
                        {c.lastMessageAt && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(c.lastMessageAt))}
                          </span>
                        )}
                      </Link>
                    ))
                  ) : (
                    <p className="py-6 text-sm text-muted-foreground">
                      No messages yet. Connect the Page in Settings, then message your studio to
                      test it.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-display text-base tracking-[0.06em] text-charcoal">
                    Waiting for your OK
                  </h2>
                  <Link
                    href="/messages"
                    className="text-xs text-sepia underline-offset-2 hover:underline"
                  >
                    Review
                  </Link>
                </div>

                {pending?.length ? (
                  <div className="mt-4 space-y-3">
                    {pending.slice(0, 2).map((draft) => (
                      <div
                        key={draft.id}
                        className={cn(
                          "rounded-xl border p-3",
                          draft.isSensitive
                            ? "border-destructive/40 bg-destructive/5"
                            : "border-border bg-surface"
                        )}
                      >
                        <p className="mb-1.5 flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.16em] text-sepia">
                          {draft.isSensitive ? (
                            <>
                              <ShieldCheck className="h-3 w-3 text-destructive" />
                              <span className="text-destructive">Needs a person</span>
                            </>
                          ) : (
                            <>Draft to {nameFor(draft.conversationId)}</>
                          )}
                        </p>
                        {!!draft.photoUrls?.length && (
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            {draft.photoUrls.map((url) => (
                              <img
                                key={url}
                                src={url}
                                alt="Reference photo"
                                className="h-14 w-14 rounded-lg border border-border object-cover"
                              />
                            ))}
                          </div>
                        )}
                        <p className="line-clamp-3 text-sm text-charcoal">{draft.draftText}</p>
                      </div>
                    ))}
                    <Link href="/messages">
                      <Button className="w-full">
                        Review {pending.length} {pending.length === 1 ? "draft" : "drafts"}
                        <ArrowRight className="ml-2 h-3.5 w-3.5" />
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <p className="mt-4 py-6 text-sm text-muted-foreground">
                    All caught up — nothing waiting to send.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* The studio's own posts, running down the side like a feed. */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-display text-base tracking-[0.06em] text-charcoal">
                    Live feed
                  </h2>
                  <Link
                    href="/feed"
                    className="text-xs text-sepia underline-offset-2 hover:underline"
                  >
                    See all
                  </Link>
                </div>
                <div className="mt-4">
                  <LiveFeed variant="rail" limit={3} />
                </div>
              </CardContent>
            </Card>
          </div>

          <div ref={lowerRef} className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-display text-base tracking-[0.06em] text-charcoal">
                    Upcoming bookings
                  </h2>
                  <Link
                    href="/bookings"
                    className="text-xs text-sepia underline-offset-2 hover:underline"
                  >
                    View all
                  </Link>
                </div>

                <div className="mt-4 divide-y divide-border">
                  {bookings?.length ? (
                    bookings.slice(0, 4).map((booking) => (
                      <div key={booking.label + booking.title} className="flex items-center gap-3 py-3">
                        <Avatar name={booking.title} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-charcoal">{booking.title}</p>
                          <p className="truncate text-xs text-muted-foreground">{booking.label}</p>
                        </div>
                        <CalendarCheck className="h-4 w-4 shrink-0 text-sepia" />
                      </div>
                    ))
                  ) : (
                    <p className="py-6 text-sm text-muted-foreground">
                      {timely?.calendarIcsUrl
                        ? "Nothing booked in the next 30 days."
                        : "Add your calendar link in Settings and your bookings appear here."}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-display text-base tracking-[0.06em] text-charcoal">
                    Post scheduler
                  </h2>
                  <Link
                    href="/posts"
                    className="text-xs text-sepia underline-offset-2 hover:underline"
                  >
                    Open
                  </Link>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">
                  Schedule posts to the Page and generate captions in the studio's voice.
                </p>
                <Link href="/posts">
                  <Button variant="outline" className="mt-4 w-full">
                    Plan a post
                    <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <h2 className="font-display text-base tracking-[0.06em] text-charcoal">
                Live activity
              </h2>
              <div className="mt-4 space-y-3">
                {pending?.length || conversations?.length ? (
                  <>
                    {pending?.slice(0, 3).map((draft) => (
                      <div key={`d${draft.id}`} className="flex gap-3">
                        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-beige/30 text-sepia">
                          <PenLine className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-charcoal">Draft ready</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {nameFor(draft.conversationId)}
                          </p>
                        </div>
                        {draft.createdAt && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(draft.createdAt))}
                          </span>
                        )}
                      </div>
                    ))}
                    {conversations?.slice(0, 3).map((c) => (
                      <div key={`c${c.conversationId}`} className="flex gap-3">
                        <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-beige/30 text-sepia">
                          <MessageCircle className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-charcoal">Messenger enquiry</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {c.senderName || "Unknown customer"}
                          </p>
                        </div>
                        {c.lastMessageAt && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(c.lastMessageAt))}
                          </span>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="py-4 text-sm text-muted-foreground">
                    Activity shows up here as customers message the Page.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h2 className="font-display text-base tracking-[0.06em] text-charcoal">
                Settings &amp; integrations
              </h2>
              <div className="mt-3 divide-y divide-border">
                <IntegrationRow
                  icon={Facebook}
                  label="Facebook Page"
                  connected={!!fb?.isConfigured}
                  tint="bg-[#1877F2]/10 text-[#1877F2]"
                />
                <IntegrationRow
                  icon={CalendarCheck}
                  label="Calendar"
                  connected={!!timely?.calendarIcsUrl}
                  tint="bg-beige/40 text-sepia"
                />
                <IntegrationRow
                  icon={Instagram}
                  label="Instagram"
                  connected={false}
                  tint="bg-[#E1306C]/10 text-[#E1306C]"
                />
                <IntegrationRow
                  icon={Globe}
                  label="Booking alerts"
                  connected={!!fb?.hasOwner}
                  tint="bg-beige/40 text-sepia"
                />
              </div>
              <Link href="/settings#connections">
                <Button variant="outline" className="mt-4 w-full">
                  Manage connections
                  <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
