import { useEffect, useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { ArrowRight, CalendarPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Art } from "./Art";

/** "2:30pm" from minutes past midnight on the studio's clock. */
function clock(minutes: number) {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** A calendar title is often "Ella – fine line forearm"; the front bit is the person. */
function who(title: string) {
  return title.split(/\s[–—-]\s|:|\(/)[0].trim() || title;
}

/**
 * Today's calendar with the studio's clock kept moving between reads. The
 * server says what time it is in the studio when it answers; the minutes that
 * pass after that are added here, so the timeline creeps along without asking
 * again every minute.
 */
function useToday() {
  const query = trpc.calendar.today.useQuery(undefined, { refetchInterval: 5 * 60_000 });
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const data = query.data;
  const nowMin = data ? data.nowMin + (Date.now() - query.dataUpdatedAt) / 60_000 : null;
  const bookings = data?.bookings ?? [];
  const current = nowMin == null ? undefined : bookings.find((b) => b.startMin <= nowMin && nowMin < b.endMin);
  const next = nowMin == null ? undefined : bookings.find((b) => b.startMin > nowMin);
  return { ...query, nowMin, bookings, current, next };
}

function Tile({
  href,
  label,
  image,
  imageClass,
  big,
  small,
}: {
  href: string;
  label: string;
  image: string;
  imageClass: string;
  big: string;
  small: string;
}) {
  return (
    <Link
      href={href}
      className="group relative block h-[132px] rounded-[26px] border border-sepia/20 bg-card/85 p-3.5 text-charcoal shadow-soft backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-sepia/45 hover:shadow-lift"
    >
      <span
        aria-hidden="true"
        className="home-glow pointer-events-none absolute -right-2 -top-3 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgb(var(--c-accent-strong)/0.32),transparent_66%)]"
      />
      <Art src={image} className={cn("absolute drop-shadow-[0_10px_14px_rgb(0_0_0/0.5)]", imageClass)} />
      <span className="block text-[0.64rem] font-semibold uppercase tracking-[0.2em] text-sepia">{label}</span>
      <span className="absolute inset-x-3.5 bottom-3">
        <span className="block font-display text-[1.75rem] font-medium uppercase leading-none">{big}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{small}</span>
      </span>
    </Link>
  );
}

export function TodayTiles() {
  const today = useToday();
  const { data: posts } = trpc.posts.getScheduled.useQuery(undefined, { refetchInterval: 60_000 });

  const queued = (posts ?? [])
    .filter((post) => post.status === "scheduled" && new Date(post.scheduledAt) > new Date())
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  const n = today.bookings.length;
  const bookingsBig = !today.data ? "—" : today.data.connected ? `${n} today` : "Calendar";
  const bookingsSmall = !today.data
    ? " "
    : !today.data.connected
      ? "Add your calendar link"
      : today.current
        ? `${who(today.current.title)} in the chair`
        : today.next
          ? `Next ${clock(today.next.startMin)} · ${who(today.next.title)}`
          : n
            ? "All done for today"
            : "Nothing booked today";

  const next = queued[0];
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile
        href={today.data && !today.data.connected ? "/settings#connections" : "/bookings"}
        label="Bookings"
        image="/home/bookings.webp"
        imageClass="-right-2 -top-4 h-[92px] w-[86px]  home-bob-slow"
        big={bookingsBig}
        small={bookingsSmall}
      />
      <Tile
        href="/posts"
        label="Posts"
        image="/home/posts.webp"
        imageClass="-right-2.5 -top-1 h-[78px] w-[92px] home-bob"
        big={`${queued.length} queued`}
        small={next ? `Next ${format(new Date(next.scheduledAt), "EEE h:mmaaa")}` : "Plan a batch of posts"}
      />
    </div>
  );
}

/**
 * The day as a line that inks itself in up to now, with a tattoo machine on
 * the needle point. It hums while somebody is in the chair.
 */
export function ChairTimeline() {
  const today = useToday();
  const [settled, setSettled] = useState(false);

  if (today.data && !today.data.connected) {
    return (
      <Link
        href="/settings#connections"
        className="flex items-center gap-3 rounded-[26px] border border-sepia/20 bg-card/85 p-4 text-sm text-charcoal shadow-soft backdrop-blur-md hover:border-sepia/45"
      >
        <CalendarPlus className="h-5 w-5 shrink-0 text-sepia" />
        <span className="flex-1">Add your booking calendar and today's chair shows up here.</span>
        <ArrowRight className="h-4 w-4 text-sepia" />
      </Link>
    );
  }

  const bookings = today.bookings;
  const nowMin = today.nowMin ?? 0;
  // Opening hours unless the day runs outside them.
  const from = Math.min(10 * 60, ...bookings.map((b) => Math.floor(b.startMin / 60) * 60));
  const to = Math.max(18 * 60, ...bookings.map((b) => Math.ceil(b.endMin / 60) * 60));
  const span = Math.max(60, to - from);
  const at = (minutes: number) => Math.min(1, Math.max(0, (minutes - from) / span));
  const now = at(nowMin);
  const mid = from + Math.round(span / 2 / 60) * 60;

  const headline = today.current
    ? `Now · ${who(today.current.title)}`
    : today.next
      ? `Next · ${clock(today.next.startMin)} ${who(today.next.title)}`
      : bookings.length
        ? "All done for today"
        : today.data?.failed
          ? "Couldn't read the calendar"
          : "Nothing booked today";

  return (
    <Link
      href="/bookings"
      className="block rounded-[26px] border border-sepia/20 bg-card/85 px-4 pb-3 pt-3.5 text-charcoal shadow-soft backdrop-blur-md transition-colors hover:border-sepia/45"
    >
      <span className="flex items-baseline justify-between gap-3">
        <b className="text-[0.86rem] font-semibold">In the chair today</b>
        <span className="truncate text-xs font-medium text-sepia">{headline}</span>
      </span>

      <span className="relative mx-1 mt-7 block h-10">
        <span className="absolute inset-x-0 top-[13px] h-[2px] rounded-full bg-border" />
        <span
          onAnimationEnd={() => setSettled(true)}
          style={{ ["--now" as string]: now, width: `${now * 100}%` }}
          className={cn(
            "absolute left-0 top-[12px] h-1 rounded-full bg-primary shadow-[0_0_10px_rgb(var(--c-accent-strong)/0.7)] transition-[width] duration-1000",
            !settled && "home-ink-fill"
          )}
        />
        {bookings.map((b) => {
          const done = b.endMin <= nowMin;
          const live = b.startMin <= nowMin && nowMin < b.endMin;
          return (
            <span
              key={`${b.startMin}-${b.title}`}
              title={`${clock(b.startMin)}–${clock(b.endMin)} · ${b.title}`}
              style={{ left: `${at(b.startMin) * 100}%`, width: `${Math.max(2, (at(b.endMin) - at(b.startMin)) * 100)}%` }}
              className={cn(
                "absolute top-[8px] h-3 rounded-full",
                live
                  ? "animate-glow-pulse bg-primary"
                  : done
                    ? "bg-primary/45"
                    : "border-[1.5px] border-primary bg-card"
              )}
            />
          );
        })}
        <span
          aria-hidden="true"
          style={{ ["--now" as string]: now, left: `max(40px, ${now * 100}%)` }}
          className={cn(
            "absolute -top-[36px] -ml-[41px] h-[52px] w-[45px] transition-[left] duration-1000",
            !settled && "home-ink-ride"
          )}
        >
          <Art
            src="/home/machine.webp"
            className={cn("h-[52px] w-[45px] drop-shadow-[0_4px_6px_rgb(0_0_0/0.6)]", today.current && "home-buzz")}
          />
        </span>
        <span className="absolute left-0 top-[24px] text-[0.64rem] text-muted-foreground">{clock(from)}</span>
        <span className="absolute top-[24px] -translate-x-1/2 text-[0.64rem] text-muted-foreground" style={{ left: `${at(mid) * 100}%` }}>
          {clock(mid)}
        </span>
        <span className="absolute right-0 top-[24px] text-[0.64rem] text-muted-foreground">{clock(to)}</span>
      </span>
    </Link>
  );
}
