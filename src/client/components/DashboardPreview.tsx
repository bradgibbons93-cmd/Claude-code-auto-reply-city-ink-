import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarCheck,
  ChevronDown,
  Image as ImageIcon,
  LayoutGrid,
  MessageSquare,
  Search,
  Send,
  Settings,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { previewStyle, type Look } from "@/lib/themes";
import { firstName, initials } from "@/lib/session";

export interface PreviewIdentity {
  studioName: string;
  location?: string | null;
  logoUrl?: string | null;
  coverUrl?: string | null;
  userName: string;
  avatarUrl?: string | null;
}

const PEOPLE = [
  { name: "Chloe H.", line: "Chloe sent 2 photos.", time: "4m", ig: true },
  { name: "Mason R.", line: "How much for a half sleeve?", time: "22m", ig: true },
  { name: "Ava L.", line: "Any spots free Saturday?", time: "1h", ig: false },
];

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** Scales a fixed-size design to whatever width it's given. */
function useFit(designWidth: number) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / designWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [designWidth]);
  return { box, scale };
}

function StudioMark({ id, size = 36 }: { id: PreviewIdentity; size?: number }) {
  return id.logoUrl ? (
    <img
      src={id.logoUrl}
      alt=""
      className="shrink-0 rounded-xl bg-card object-contain p-1 shadow-soft"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl bg-primary font-display text-primary-foreground shadow-soft"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials(id.studioName).slice(0, 1)}
    </span>
  );
}

function Person({ id, size = 30 }: { id: PreviewIdentity; size?: number }) {
  return id.avatarUrl ? (
    <img src={id.avatarUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-beige text-charcoal"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(id.userName)}
    </span>
  );
}

function Banner({ id, compact }: { id: PreviewIdentity; compact?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[rgb(var(--c-banner))] text-[rgb(var(--c-banner-fg))] shadow-lift">
      {id.coverUrl && (
        <img src={id.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-[rgb(var(--c-banner-deep))] via-[rgb(var(--c-banner-deep)/0.75)] to-transparent" />
      <div className={cn("relative", compact ? "p-4" : "p-6")}>
        <p className="text-[0.55rem] uppercase tracking-[0.32em] text-[rgb(var(--c-banner-accent))]">
          {id.studioName}
          {id.location ? ` · ${id.location}` : ""}
        </p>
        <p className={cn("mt-2 font-display leading-tight", compact ? "text-[1.55rem]" : "text-[2rem]")}>
          {greeting()}, {firstName(id.userName) || "there"}
        </p>
        <p className="mt-1.5 text-[0.72rem] opacity-80">3 replies are written and waiting on your OK.</p>
        <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--c-banner-accent))] px-3.5 py-1.5 text-[0.68rem] font-medium text-[rgb(var(--c-banner-deep))]">
          Review the drafts
        </span>
      </div>
    </div>
  );
}

function InboxRows() {
  return (
    <div className="divide-y divide-border">
      {PEOPLE.map((p) => (
        <div key={p.name} className="flex items-center gap-2.5 py-2">
          <span className="relative">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-beige text-[0.6rem] text-charcoal">
              {initials(p.name)}
            </span>
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                p.ig ? "bg-gradient-to-tr from-[#f58529] via-[#dd2a7b] to-[#8134af]" : "bg-[#0a7cff]"
              )}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.72rem] font-semibold text-charcoal">{p.name}</span>
            <span className="block truncate text-[0.65rem] text-muted-foreground">
              {p.line} · {p.time}
            </span>
          </span>
          <span className="rounded-full bg-sepia/15 px-1.5 py-0.5 text-[0.5rem] uppercase tracking-wider text-sepia">
            Draft
          </span>
          <span className="h-2 w-2 rounded-full bg-destructive" />
        </div>
      ))}
    </div>
  );
}

function DraftCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-soft">
      <p className="flex items-center gap-1 text-[0.52rem] uppercase tracking-[0.18em] text-sepia">
        <Sparkles className="h-2.5 w-2.5" /> Draft reply
      </p>
      <p className="mt-1.5 text-[0.68rem] leading-snug text-charcoal">
        Hey Chloe 😊 thanks for the photos! A small fine-line piece like that is about $200 – $250. Want a time this week?
      </p>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="rounded-full border border-sepia bg-sepia/10 px-2 py-0.5 text-[0.52rem] text-sepia">Recommended</span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[0.52rem] text-muted-foreground">Short</span>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[0.58rem] text-primary-foreground">
          <Send className="h-2.5 w-2.5" /> Approve & send
        </span>
      </div>
    </div>
  );
}

function PhoneDesign({ id }: { id: PreviewIdentity }) {
  return (
    <div className="flex h-[760px] w-[390px] flex-col gap-3 bg-background p-4" style={{ backgroundImage: "var(--page-wash)" }}>
      <div className="flex items-center gap-2.5">
        <StudioMark id={id} size={34} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[0.95rem] text-charcoal">{id.studioName}</p>
          {id.location && <p className="truncate text-[0.6rem] text-muted-foreground">{id.location}</p>}
        </div>
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-charcoal">
          <Bell className="h-3.5 w-3.5" />
        </span>
        <Person id={id} size={32} />
      </div>
      <Banner id={id} compact />
      <div className="grid grid-cols-2 gap-2.5">
        {[
          ["Messages today", "12"],
          ["Drafts waiting", "3"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-3 shadow-soft">
            <p className="font-display text-2xl text-charcoal">{value}</p>
            <p className="mt-1 text-[0.52rem] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-border bg-card px-3 pt-2.5 shadow-soft">
        <p className="font-display text-[0.9rem] text-charcoal">Needs a reply</p>
        <InboxRows />
      </div>
      <DraftCard />
    </div>
  );
}

function DesktopDesign({ id }: { id: PreviewIdentity }) {
  const nav: [typeof LayoutGrid, string, string?][] = [
    [LayoutGrid, "Dashboard"],
    [MessageSquare, "Messages", "3"],
    [CalendarCheck, "Bookings"],
    [ImageIcon, "Content"],
    [Settings, "Settings"],
  ];
  return (
    <div className="flex h-[560px] w-[960px] bg-background" style={{ backgroundImage: "var(--page-wash)" }}>
      <aside className="flex w-[200px] flex-col border-r border-border bg-[rgb(var(--glass-bg)/var(--glass-alpha))] p-3">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-soft">
          <StudioMark id={id} size={30} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.72rem] font-semibold text-charcoal">{id.studioName}</span>
            <span className="block truncate text-[0.58rem] text-muted-foreground">{id.location || "Your studio"}</span>
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </div>
        <div className="mt-4 space-y-0.5">
          {nav.map(([Icon, label, count], i) => (
            <div
              key={label}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[0.7rem]",
                i === 0 ? "bg-beige/40 text-charcoal shadow-soft" : "text-muted-foreground"
              )}
            >
              <Icon className={cn("h-3 w-3", i === 0 && "text-sepia")} />
              <span className="flex-1">{label}</span>
              {count && (
                <span className="rounded-full bg-primary px-1.5 text-[0.55rem] text-primary-foreground">{count}</span>
              )}
            </div>
          ))}
        </div>
        <p className="mt-auto text-center text-[0.5rem] uppercase tracking-[0.3em] text-muted-foreground">
          Powered by Runnit
        </p>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
          <span className="flex flex-1 items-center gap-1.5 rounded-lg border border-border bg-input px-2.5 py-1.5 text-[0.62rem] text-muted-foreground">
            <Search className="h-3 w-3" /> Search messages…
          </span>
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-charcoal">
            <Bell className="h-3 w-3" />
          </span>
          <span className="flex items-center gap-1.5 rounded-lg border border-border py-1 pl-1 pr-2">
            <Person id={id} size={22} />
            <span className="text-[0.62rem] text-charcoal">{firstName(id.userName) || "You"}</span>
          </span>
        </div>
        <div className="grid flex-1 grid-cols-[1.35fr_1fr] gap-3 p-5">
          <div className="flex flex-col gap-3">
            <Banner id={id} />
            <div className="grid grid-cols-3 gap-2.5">
              {[
                ["Messages today", "12"],
                ["Drafts waiting", "3"],
                ["New bookings", "2"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-border bg-card p-3 shadow-soft">
                  <p className="font-display text-2xl text-charcoal">{value}</p>
                  <p className="mt-1 text-[0.5rem] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-border bg-card px-3 pt-2.5 shadow-soft">
              <p className="font-display text-[0.9rem] text-charcoal">Needs a reply</p>
              <InboxRows />
            </div>
            <DraftCard />
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * A miniature of the real dashboard in a given look, with the studio's own
 * name, logo, banner and the owner's photo in it. Scales to fit its box.
 */
export function DashboardPreview({
  look,
  identity,
  variant = "phone",
  className,
}: {
  look: Look;
  identity: PreviewIdentity;
  variant?: "phone" | "desktop";
  className?: string;
}) {
  const designWidth = variant === "phone" ? 390 : 960;
  const designHeight = variant === "phone" ? 760 : 560;
  const { box, scale } = useFit(designWidth);
  return (
    <div
      ref={box}
      className={cn("relative w-full overflow-hidden", className)}
      style={{ height: designHeight * scale }}
      aria-hidden
    >
      <div
        className="absolute left-0 top-0 origin-top-left transition-[background-color,color] duration-500"
        style={{ ...previewStyle(look), transform: `scale(${scale})`, width: designWidth, height: designHeight }}
      >
        {variant === "phone" ? <PhoneDesign id={identity} /> : <DesktopDesign id={identity} />}
      </div>
    </div>
  );
}
