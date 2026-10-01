import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarCheck,
  ChevronDown,
  House,
  Image as ImageIcon,
  LayoutGrid,
  Menu,
  MessageSquare,
  PenLine,
  Search,
  Send,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { previewStyle, type Look } from "@/lib/themes";
import { firstName, initials } from "@/lib/session";
import { Art } from "@/components/home/Art";

export interface PreviewIdentity {
  studioName: string;
  location?: string | null;
  logoUrl?: string | null;
  coverUrl?: string | null;
  userName: string;
  avatarUrl?: string | null;
}

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
      className="shrink-0 rounded-full border border-sepia/60 bg-card object-contain p-1"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border border-sepia/60 bg-card font-display uppercase text-sepia"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(id.studioName)}
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

/* The same pieces as the real Home screen (pages/Home.tsx), drawn still. */

function Backdrop({ id }: { id: PreviewIdentity }) {
  return (
    <div className="home-flash-fade pointer-events-none absolute inset-x-0 top-0 h-[420px] overflow-hidden">
      {id.coverUrl && (
        <>
          <img src={id.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />
          <div className="absolute inset-0 bg-background/55" />
        </>
      )}
      <div className="home-flash relative h-full w-full" />
    </div>
  );
}

function HomeHeader({ id }: { id: PreviewIdentity }) {
  return (
    <div className="relative flex items-center gap-2.5">
      <StudioMark id={id} size={38} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.85rem] font-semibold text-charcoal">{id.studioName}</p>
        <p className="truncate text-[0.62rem] text-muted-foreground">
          {greeting()}, {firstName(id.userName) || "there"}
        </p>
      </div>
      <span className="flex items-center gap-1.5 rounded-full border border-sepia/45 bg-card/80 px-2.5 py-1.5 text-[0.58rem] font-semibold text-charcoal">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" /> AI replies live
      </span>
    </div>
  );
}

function ReplyHero() {
  return (
    <div className="relative rounded-[24px] border border-sepia/25 bg-card/85 p-3.5 shadow-lift">
      <span className="absolute -top-6 right-0 h-28 w-28 rounded-full bg-[radial-gradient(circle,rgb(var(--c-accent-strong)/0.45),transparent_66%)]" />
      <Art src="/home/reply.webp" className="absolute -top-4 right-1 h-[84px] w-[80px]" />
      <p className="text-[0.52rem] font-semibold uppercase tracking-[0.24em] text-sepia">AI replies · 12 DMs today</p>
      <p className="mt-1 max-w-[72%] font-display text-[1.9rem] font-medium uppercase leading-[0.95] text-charcoal">3 ready to send</p>
      <p className="mt-1 text-[0.6rem] text-muted-foreground">Swipe right to send · left to edit</p>
      <div className="relative mt-3 h-[150px]">
        <div className="absolute inset-x-0 top-[16px] h-[134px] scale-[0.9] rounded-[18px] border border-border bg-elevated opacity-45" />
        <div className="absolute inset-x-0 top-[8px] h-[134px] scale-[0.95] rounded-[18px] border border-border bg-elevated opacity-80" />
        <div className="absolute inset-x-0 top-0 flex h-[134px] flex-col gap-1.5 rounded-[18px] border border-sepia/35 bg-elevated px-3 py-2.5 shadow-soft">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-beige/40 text-[0.5rem] text-charcoal">CH</span>
            <span>
              <span className="block text-[0.68rem] font-semibold text-charcoal">Chloe H.</span>
              <span className="block text-[0.5rem] text-muted-foreground">4 minutes ago</span>
            </span>
          </div>
          <p className="truncate text-[0.6rem] text-muted-foreground">“how much for a small fine line rose?”</p>
          <p className="flex items-center gap-1.5 text-[0.46rem] font-semibold uppercase tracking-[0.22em] text-sepia">
            <span className="h-1 w-1 rotate-45 bg-sepia" /> Runnit's reply <span className="h-px flex-1 bg-sepia/35" />
          </p>
          <p className="text-[0.66rem] leading-snug text-charcoal">
            Hey Chloe! A small fine line rose is one of our faves. Send a pic of the spot and I'll get you a quote.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-charcoal">
          <PenLine className="h-3.5 w-3.5" />
        </span>
        <span className="text-[0.55rem] text-muted-foreground">1 of 3</span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[0.62rem] font-semibold text-primary-foreground">
          <Send className="h-3 w-3" /> Send
        </span>
      </div>
    </div>
  );
}

function TodayPieces() {
  return (
    <div className="space-y-2.5">
      <p className="text-[0.72rem] font-semibold text-charcoal">Today at the studio</p>
      <div className="grid grid-cols-2 gap-2.5">
        {[
          ["Bookings", "3 today", "Next 2:30pm · Mason", "/home/bookings.webp", "-right-1 -top-3 h-[70px] w-[64px]"],
          ["Posts", "2 queued", "Next Wed 6:00pm", "/home/posts.webp", "-right-2 -top-1 h-[58px] w-[68px]"],
        ].map(([label, big, small, image, place]) => (
          <div key={label} className="relative h-[98px] rounded-[18px] border border-sepia/20 bg-card/85 p-2.5 shadow-soft">
            <Art src={image} className={cn("absolute", place)} />
            <p className="text-[0.46rem] font-semibold uppercase tracking-[0.2em] text-sepia">{label}</p>
            <p className="absolute bottom-6 left-2.5 font-display text-[1.25rem] font-medium uppercase leading-none text-charcoal">{big}</p>
            <p className="absolute bottom-2.5 left-2.5 text-[0.52rem] text-muted-foreground">{small}</p>
          </div>
        ))}
      </div>
      <div className="rounded-[18px] border border-sepia/20 bg-card/85 px-3 pb-2 pt-2.5 shadow-soft">
        <p className="flex justify-between text-[0.6rem]">
          <b className="font-semibold text-charcoal">In the chair today</b>
          <span className="text-sepia">Now · Ava</span>
        </p>
        <div className="relative mt-5 h-6">
          <span className="absolute inset-x-0 top-[9px] h-[2px] rounded-full bg-border" />
          <span className="absolute left-0 top-[8px] h-1 w-[55%] rounded-full bg-primary" />
          <span className="absolute left-[12%] top-[5px] h-2.5 w-[18%] rounded-full bg-primary/45" />
          <span className="absolute left-[45%] top-[5px] h-2.5 w-[18%] rounded-full bg-primary" />
          <span className="absolute left-[74%] top-[5px] h-2.5 w-[10%] rounded-full border border-primary bg-card" />
          <Art src="/home/machine.webp" className="absolute -top-[26px] left-[55%] -ml-[30px] h-[38px] w-[33px]" />
        </div>
      </div>
    </div>
  );
}

function PhoneDesign({ id }: { id: PreviewIdentity }) {
  return (
    <div className="relative flex h-[760px] w-[390px] flex-col gap-4 overflow-hidden bg-background p-4" style={{ backgroundImage: "var(--page-wash)" }}>
      <Backdrop id={id} />
      <HomeHeader id={id} />
      <div className="relative">
        <ReplyHero />
      </div>
      <div className="relative">
        <TodayPieces />
      </div>
      <div className="absolute inset-x-3 bottom-3 grid grid-cols-5 gap-1 rounded-[22px] border border-border bg-[rgb(var(--glass-bg)/var(--glass-alpha))] p-1 shadow-lift">
        {[
          [House, "Home"],
          [MessageSquare, "Messages"],
          [CalendarCheck, "Bookings"],
          [ImageIcon, "Posts"],
          [Menu, "More"],
        ].map(([Icon, label], i) => {
          const I = Icon as typeof House;
          return (
            <span
              key={label as string}
              className={cn(
                "flex h-10 flex-col items-center justify-center gap-0.5 rounded-[18px] text-[0.5rem]",
                i === 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
            >
              <I className="h-3.5 w-3.5" />
              {label as string}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function DesktopDesign({ id }: { id: PreviewIdentity }) {
  const nav: [typeof LayoutGrid, string, string?][] = [
    [LayoutGrid, "Home"],
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
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative z-10 flex items-center gap-2 border-b border-border px-5 py-2.5">
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
        <div className="relative flex-1 p-5">
          <Backdrop id={id} />
          <div className="relative">
            <HomeHeader id={id} />
          </div>
          <div className="relative mt-4 grid grid-cols-[1.1fr_1fr] gap-4">
            <ReplyHero />
            <TodayPieces />
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * A miniature of the real Home screen in a given look, with the studio's own
 * name, logo, banner and the owner's photo in it. Scales to fit its box.
 * Built from the same pieces and pictures as pages/Home.tsx — if the Home
 * screen changes, change this with it, or "every card is your actual
 * dashboard" stops being true.
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
