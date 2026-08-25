import { Link } from "wouter";
import { ArrowRight, CalendarDays, MessageCircle, PenLine } from "lucide-react";
import { StampBadge } from "@/components/Logo";

/**
 * The masthead the dashboard opens on.
 *
 * It replaces a plain "Good afternoon, Brad" line, and earns the space by
 * answering the only question worth asking on arrival: is anything waiting on
 * me? So the headline is the state of the queue, not the time of day, and the
 * button only appears when there's something to press it for.
 *
 * The slab stays dark in both themes — a hero that flips to paper in light
 * mode stops reading as a banner — and takes its accent from the theme, so it
 * carries the studio's gold on the light side and the violet on the dark.
 */
export default function DashboardBanner({
  greeting,
  pendingCount,
  messagesToday,
  nextBooking,
}: {
  greeting: string;
  pendingCount: number;
  messagesToday?: number | null;
  nextBooking?: { title: string; label: string } | null;
}) {
  const waiting = pendingCount > 0;

  return (
    <section
      className="relative overflow-hidden rounded-2xl px-6 py-7 sm:px-9 sm:py-9"
      style={{
        background:
          "linear-gradient(135deg, rgb(var(--c-banner)) 0%, rgb(var(--c-banner-deep)) 100%)",
        color: "rgb(var(--c-banner-fg))",
      }}
    >
      {/* The badge, oversized and nearly submerged — texture, not decoration.
          aria-hidden because it repeats the wordmark already in the sidebar. */}
      <StampBadge
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-12 h-64 w-64 opacity-[0.07] sm:-right-4 sm:h-72 sm:w-72"
      />

      {/* A soft wash of the accent so the slab isn't flat black. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full opacity-20 blur-3xl"
        style={{ background: "rgb(var(--c-banner-accent))" }}
      />

      <div className="relative">
        <p
          className="text-[0.6rem] uppercase tracking-[0.42em]"
          style={{ color: "rgb(var(--c-banner-accent))" }}
        >
          City Ink · Tattoo Geelong
        </p>

        <h1 className="mt-3 font-display text-3xl leading-tight tracking-[0.03em] sm:text-4xl">
          {greeting}, Brad
        </h1>

        <p className="mt-2 max-w-lg text-sm opacity-70">
          {waiting
            ? `${pendingCount} ${pendingCount === 1 ? "reply is" : "replies are"} written and waiting on your OK. Nothing has gone out without you.`
            : "Every message is answered. Nothing is waiting on you."}
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-x-7 gap-y-3">
          <Figure
            icon={PenLine}
            value={String(pendingCount)}
            label={pendingCount === 1 ? "waiting on you" : "waiting on you"}
          />
          <Figure
            icon={MessageCircle}
            value={String(messagesToday ?? 0)}
            label="messages today"
          />
          {nextBooking && (
            <Figure
              icon={CalendarDays}
              value={nextBooking.label}
              label={nextBooking.title}
              wide
            />
          )}

          {waiting && (
            <Link
              href="/messages"
              className="ml-auto inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition-transform hover:-translate-y-0.5"
              style={{
                background: "rgb(var(--c-banner-accent))",
                color: "rgb(var(--c-banner-deep))",
              }}
            >
              Review {pendingCount === 1 ? "the draft" : "the drafts"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      {/* The hairline the rest of the app uses, at the foot of the slab. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-50"
        style={{
          background:
            "linear-gradient(to right, transparent, rgb(var(--c-banner-accent)), transparent)",
        }}
      />
    </section>
  );
}

function Figure({
  icon: Icon,
  value,
  label,
  wide,
}: {
  icon: typeof MessageCircle;
  value: string;
  label: string;
  wide?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 shrink-0 opacity-50" />
      <div className="min-w-0">
        <p
          className={`font-display leading-none ${wide ? "text-base" : "text-xl"} tabular-nums`}
        >
          {value}
        </p>
        <p className="mt-1 truncate text-[0.65rem] uppercase tracking-[0.16em] opacity-55">
          {label}
        </p>
      </div>
    </div>
  );
}
