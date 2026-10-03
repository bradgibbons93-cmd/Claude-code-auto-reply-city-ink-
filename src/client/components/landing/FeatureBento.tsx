import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BellRing,
  CalendarCheck,
  Check,
  HandHeart,
  Inbox,
  PenLine,
  QrCode,
  RefreshCw,
  ScanSearch,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./motion";
import { Avatar, DemoTag, Emblem, FacebookBadge, IgBadge, PeonyLineArt } from "./primitives";

type Icon = LucideIcon;

function BentoCard({
  icon: Icon,
  title,
  body,
  children,
  className,
  delay = 0,
  aside,
}: {
  icon: Icon;
  title: string;
  body: ReactNode;
  children: ReactNode;
  className?: string;
  delay?: number;
  aside?: ReactNode;
}) {
  return (
    <Reveal delay={delay} className={cn("h-full", className)}>
      <article className="rn-card rn-lift relative flex h-full flex-col overflow-hidden rounded-[28px] p-5 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
        />
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#D9A94E]/10 text-[#F6D58E] ring-1 ring-inset ring-[#D9A94E]/25">
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </span>
          <h3 className="min-w-0 flex-1 text-[17px] font-semibold leading-snug sm:text-[18px] tracking-[-0.02em] text-[#F4F1EA]">{title}</h3>
          {aside ? <span className="shrink-0 self-start pt-1.5">{aside}</span> : null}
        </div>
        <p className="mt-3 max-w-[46ch] text-pretty text-[15px] leading-relaxed text-[#A6A09A]">{body}</p>
        <div className="mt-6 flex flex-1 flex-col justify-end">{children}</div>
      </article>
    </Reveal>
  );
}

/* ------------------------------------------------------------- visuals -- */

const INBOX = [
  { initials: "CH", name: "Chloe H.", platform: "ig" as const, preview: "Chloe sent 2 photos.", time: "2m", tone: 0 },
  { initials: "MR", name: "Mason R.", platform: "fb" as const, preview: "How much for a black and grey half sleeve?", time: "18m", tone: 1 },
  { initials: "AL", name: "Ava L.", platform: "ig" as const, preview: "Replied to your story: is this flash still available?", time: "1h", tone: 2 },
];

function InboxVisual() {
  return (
    <div className="rn-inset overflow-hidden rounded-2xl">
      <div className="flex items-center gap-1 border-b border-white/[0.06] px-2.5 py-2.5 text-[12px] font-medium sm:px-3">
        <span className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[#F4F1EA]">
          Needs a reply <span className="ml-1 font-semibold text-[#F6D58E]">3</span>
        </span>
        <span className="rounded-full px-3 py-1.5 text-[#8C867F]">Replied</span>
      </div>
      <ul className="divide-y divide-white/[0.05]">
        {INBOX.map((row) => (
          <li key={row.name} className="flex items-center gap-3 px-3 py-3 sm:px-4">
            <Avatar initials={row.initials} tone={row.tone} platform={row.platform} className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[#F4F1EA]">{row.name}</p>
                <span className="shrink-0 rounded-full bg-[#D9A94E]/10 px-2 py-[3px] text-[10px] font-semibold text-[#F6D58E] ring-1 ring-inset ring-[#D9A94E]/25">
                  Draft ready
                </span>
                <span className="w-7 shrink-0 text-right text-[11.5px] text-[#8C867F]">{row.time}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#D6D0C7]">{row.preview}</p>
                <span className="mr-2.5 h-2 w-2 shrink-0 rounded-full bg-[#F6D58E] shadow-[0_0_10px_rgba(246,213,142,0.7)]" />
              </div>
            </div>
          </li>
        ))}
        <li className="flex items-center gap-3 px-3 py-3 opacity-55 sm:px-4">
          <Avatar initials="JT" tone={3} platform="fb" className="h-10 w-10" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[#D6D0C7]">Jordan T.</p>
              <span className="w-7 shrink-0 text-right text-[11.5px] text-[#8C867F]">3h</span>
            </div>
            <p className="mt-0.5 truncate text-[12.5px] text-[#8C867F]">You: See you Thursday, legend.</p>
          </div>
        </li>
      </ul>
    </div>
  );
}

const VERSIONS = [
  {
    label: "Suggested",
    text: "Hey Chloe! Love this one. At that size on the forearm it’s $350–$450 from our price list. I’ve got Thu 11am or Sat 2pm free. A $100 deposit locks it in.",
  },
  {
    label: "Short and casual",
    text: "Love it! That size is $350–$450. Thu 11am or Sat 2pm suit?",
  },
  {
    label: "Explains the work",
    text: "Fine line takes a steady hand and a bit more time, so at that size on the forearm it’s $350–$450. We can tweak the design together before the day.",
  },
  {
    label: "Pushes to book",
    text: "Thu 11am is still open and it’s yours with a $100 deposit. $350–$450 all up for that size. Want me to lock it in?",
  },
];

/** Tap a version and the draft changes — the one live control in the grid. */
function DraftsVisual() {
  const [pick, setPick] = useState(0);
  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] sm:gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <Avatar initials="CH" tone={0} platform="ig" className="h-8 w-8" />
          <div className="rounded-2xl rounded-bl-md bg-white/[0.05] px-3 py-2 text-[12.5px] leading-relaxed text-[#E9E4DB]">
            Could I get this peony on my forearm? About this big
            <span aria-hidden className="ml-1.5 inline-flex translate-y-[3px] gap-1">
              <span className="inline-block h-4 w-3.5 rounded-[3px] bg-[linear-gradient(160deg,#4A3A30,#1C1612)] ring-1 ring-inset ring-white/15" />
              <span className="inline-block h-4 w-3.5 rounded-[3px] bg-[linear-gradient(160deg,#2B2622,#16130F)] ring-1 ring-inset ring-white/15" />
            </span>
          </div>
        </div>

        <div className="flex flex-1 flex-col rounded-2xl border border-[#D9A94E]/30 bg-[linear-gradient(180deg,rgba(217,169,78,0.10),rgba(217,169,78,0.02))] p-4">
          <p className="flex items-center justify-between gap-2 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#F6D58E]">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> Draft reply
            </span>
            <span className="font-medium normal-case tracking-normal text-[#8C867F]">{VERSIONS[pick].label}</span>
          </p>
          {/* Every version sits in the same cell so the box never jumps. */}
          <div className="mt-2 grid" aria-live="polite">
            {VERSIONS.map((v, i) => (
              <p
                key={v.label}
                aria-hidden={i !== pick}
                className={cn(
                  "col-start-1 row-start-1 text-[13.5px] leading-relaxed text-[#EFEAE1] transition-opacity duration-300",
                  i === pick ? "opacity-100" : "invisible opacity-0"
                )}
              >
                {v.text}
              </p>
            ))}
          </div>
          <div aria-hidden className="mt-auto flex gap-2 pt-4">
            <span className="grid h-9 place-items-center rounded-full px-3.5 text-[12px] font-medium text-[#D8D2C9] ring-1 ring-inset ring-white/15">
              Edit
            </span>
            <span className="rn-gold-fill flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-[12.5px] font-semibold text-[#1A1206] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]">
              <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> Approve &amp; send
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col">
        <p id="rn-takes" className="px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8C867F]">
          Try another take
        </p>
        <div role="group" aria-labelledby="rn-takes" className="mt-2 grid gap-1.5">
          {VERSIONS.map((v, i) => {
            const on = i === pick;
            return (
              <button
                key={v.label}
                type="button"
                aria-pressed={on}
                onClick={() => setPick(i)}
                className={cn(
                  "flex min-h-[44px] items-center justify-between gap-3 rounded-xl px-3.5 text-left text-[13px] ring-1 ring-inset transition-[background-color,box-shadow,color] duration-200",
                  on
                    ? "bg-[#D9A94E]/[0.09] font-semibold text-[#F6D58E] ring-[#D9A94E]/40"
                    : "bg-white/[0.025] font-medium text-[#D6D0C7] ring-white/[0.07] hover:bg-white/[0.05] hover:text-[#F4F1EA]"
                )}
              >
                {v.label}
                <span
                  aria-hidden
                  className={cn(
                    "grid h-4 w-4 shrink-0 place-items-center rounded-full ring-1 ring-inset transition-colors",
                    on ? "bg-[#D9A94E] ring-[#D9A94E]" : "ring-white/20"
                  )}
                >
                  {on ? <Check className="h-2.5 w-2.5 text-[#1A1206]" strokeWidth={3.5} /> : null}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-auto flex items-start gap-2 px-1 pt-4 text-[12.5px] leading-snug text-[#8C867F]">
          <PenLine className="mt-px h-3.5 w-3.5 shrink-0 text-[#D9A94E]" />
          Change a word and the next draft sounds more like you.
        </p>
      </div>
    </div>
  );
}

function PhotosVisual() {
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex min-h-[120px] flex-1 gap-2.5">
        <div className="relative flex-1 overflow-hidden rounded-2xl bg-[linear-gradient(160deg,#4A3A30,#2A201A_60%,#1C1612)] ring-1 ring-inset ring-white/10">
          <div className="absolute inset-0 bg-[radial-gradient(90%_60%_at_30%_20%,rgba(255,226,196,0.16),transparent)]" />
          <PeonyLineArt className="absolute left-1/2 top-1/2 h-[92px] w-[66px] -translate-x-1/2 -translate-y-1/2 text-[#F4F1EA]/80" />
        </div>
        <div className="relative flex-1 overflow-hidden rounded-2xl bg-[linear-gradient(160deg,#2B2622,#16130F)] ring-1 ring-inset ring-white/10">
          <div className="absolute left-1/2 top-[-30%] h-[160%] w-[56px] -translate-x-1/2 rotate-[14deg] rounded-[30px] bg-[linear-gradient(90deg,rgba(214,168,132,0.22),rgba(236,196,160,0.34)_50%,rgba(214,168,132,0.2))]" />
          <div className="absolute left-1/2 top-1/2 h-[54px] w-[40px] -translate-x-1/2 -translate-y-[60%] rotate-[14deg] rounded-[5px] border border-dashed border-[#F6D58E]" />
          <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-[2px] text-[10px] font-semibold text-[#F6D58E]">
            Forearm · ~12 cm
          </span>
        </div>
      </div>
      <div className="rn-inset flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5">
        <span className="text-[12.5px] text-[#A6A09A]">Fine line · medium</span>
        <span className="text-[13.5px] font-semibold text-[#F6D58E]">$350–$450</span>
      </div>
    </div>
  );
}

function CalendarVisual() {
  const slots = [
    { day: "Thu", time: "11:00 am", free: true },
    { day: "Fri", time: "All day", free: false },
    { day: "Sat", time: "2:00 pm", free: true },
    { day: "Sun", time: "", free: false },
  ];
  return (
    <div className="space-y-3">
      <p className="flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8C867F]">
        <span>This week</span>
        <span className="font-medium normal-case tracking-normal">Google Calendar · Timely</span>
      </p>
      <ul className="space-y-2">
        {slots.map((s) => (
          <li
            key={s.day}
            className={cn(
              "flex items-center justify-between rounded-xl px-3.5 py-2.5 text-[13px] ring-1 ring-inset",
              s.free
                ? "bg-[#D9A94E]/[0.07] text-[#F4F1EA] ring-[#D9A94E]/30"
                : "bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.03)_0_6px,transparent_6px_12px)] text-[#6F6A64] ring-white/[0.06]"
            )}
          >
            <span className="font-semibold">{s.day}</span>
            <span className={s.free ? "text-[#F6D58E]" : ""}>{s.free ? `Free · ${s.time}` : s.time ? "Booked" : "Closed"}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-1.5 text-[11px] text-[#A6A09A]">
        {["Name", "Phone", "Dates", "Deposit"].map((f) => (
          <span key={f} className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2.5 py-1 ring-1 ring-inset ring-white/[0.08]">
            <Check className="h-3 w-3 text-[#D9A94E]" strokeWidth={2.6} />
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}

function FollowUpsVisual() {
  const items = [
    {
      when: "A quote gone quiet",
      tag: "Follow-up",
      initials: "MR",
      tone: 1,
      text: "Hey Mason, just checking in on that half sleeve. Happy to hold a spot if you’re still keen.",
    },
    {
      when: "After the appointment",
      tag: "Aftercare",
      initials: "PS",
      tone: 4,
      text: "Hey Priya! How’s the new piece healing? Any questions at all, just shout.",
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.tag} className="rn-inset flex flex-col rounded-2xl p-4">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#8C867F]">{it.when}</span>
          <div className="mt-3 flex flex-1 items-start gap-2.5">
            <Avatar initials={it.initials} tone={it.tone} className="h-8 w-8" />
            <p className="rounded-2xl rounded-tl-md bg-white/[0.05] px-3 py-2 text-[12.5px] leading-relaxed text-[#E9E4DB]">
              {it.text}
            </p>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[10.5px] font-medium text-[#CFC9C0] ring-1 ring-inset ring-white/10">
              {it.tag}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#F6D58E]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#D9A94E]" /> Waiting for your OK
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SensitiveVisual() {
  return (
    <div className="rn-inset rounded-2xl p-4">
      <div className="flex items-start gap-2.5">
        <Avatar initials="SK" tone={2} platform="ig" className="h-8 w-8" />
        <div className="flex-1 space-y-1.5 rounded-2xl rounded-tl-md bg-white/[0.05] px-3 py-2.5">
          <p className="text-[12.5px] text-[#E9E4DB]">Quick question about my medication before…</p>
          <span className="block h-2 w-[85%] rounded-full bg-white/[0.08]" />
          <span className="block h-2 w-[60%] rounded-full bg-white/[0.08]" />
        </div>
      </div>
      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F4F1EA] px-2.5 py-1 text-[11px] font-semibold text-[#141416]">
          <HandHeart className="h-3.5 w-3.5" /> For a person
        </span>
        <span className="text-[11px] text-[#8C867F]">No AI reply drafted</span>
      </div>
    </div>
  );
}

/** A deterministic, QR-looking grid — finder squares in three corners. */
function FakeQr({ size = 21, className }: { size?: number; className?: string }) {
  const cells: Array<[number, number]> = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const inFinder = (x: number, y: number) =>
    (x < 8 && y < 8) || (x > size - 9 && y < 8) || (x < 8 && y > size - 9);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inFinder(x, y)) continue;
      if (rand() > 0.52) cells.push([x, y]);
    }
  }
  const finder = (ox: number, oy: number) => (
    <g key={`${ox}-${oy}`}>
      <rect x={ox + 0.5} y={oy + 0.5} width={6} height={6} rx={1.4} fill="none" stroke="currentColor" strokeWidth={1} />
      <rect x={ox + 2} y={oy + 2} width={3} height={3} rx={0.7} fill="currentColor" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden shapeRendering="crispEdges">
      {cells.map(([x, y]) => (
        <rect key={`${x}.${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />
      ))}
      {finder(0, 0)}
      {finder(size - 7, 0)}
      {finder(0, size - 7)}
    </svg>
  );
}

function PostsVisual() {
  return (
    <div className="flex items-stretch gap-3">
      <div className="flex w-[112px] shrink-0 flex-col items-center justify-center rounded-2xl bg-[#F4F1EA] p-2.5 text-[#0B0B0F] shadow-[0_18px_40px_-20px_rgba(0,0,0,0.9)]">
        <FakeQr className="h-[88px] w-[88px]" />
        <p className="mt-1.5 text-center text-[9px] font-bold uppercase leading-tight tracking-[0.14em]">Scan to add your work</p>
      </div>
      <ul className="flex min-w-0 flex-1 flex-col justify-center gap-2">
        {[
          { when: "Fri · 6:00 pm", label: "Healed peony, forearm" },
          { when: "Sun · 10:00 am", label: "Flash day sheet" },
        ].map((p) => (
          <li key={p.when} className="rn-inset rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-1.5">
              <IgBadge className="h-3.5 w-3.5" />
              <FacebookBadge className="h-3.5 w-3.5" />
              <span className="ml-auto text-[10.5px] font-medium text-[#F6D58E]">Scheduled</span>
            </div>
            <p className="mt-1.5 truncate text-[12.5px] font-medium text-[#E9E4DB]">{p.label}</p>
            <p className="text-[11px] text-[#8C867F]">{p.when}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhoneVisual() {
  const notes = [
    { title: "New enquiry · Ava L.", body: "Draft ready. Tap to review.", time: "now" },
    { title: "Mason R. replied", body: "“Saturday works!” Draft ready.", time: "12m" },
  ];
  return (
    <div className="grid items-center gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
      <div className="space-y-2">
        {notes.map((n, i) => (
          <div
            key={n.title}
            className={cn(
              "flex items-start gap-3 rounded-2xl border border-white/10 bg-[#18181D]/90 p-3 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.9)]",
              i === 1 && "mx-3 opacity-70 sm:mx-5"
            )}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#08080A] ring-1 ring-inset ring-white/10">
              <Emblem className="h-[22px] w-[22px]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#A6A09A]">Runnit</span>
                <span className="text-[10.5px] text-[#6F6A64]">{n.time}</span>
              </div>
              <p className="truncate text-[13px] font-semibold text-[#F4F1EA]">{n.title}</p>
              <p className="truncate text-[12px] text-[#A6A09A]">{n.body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* The home-screen icon, badge and all. */}
      <div className="flex items-center gap-4 sm:flex-col sm:gap-2.5 sm:pr-4">
        <span className="relative grid h-[68px] w-[68px] shrink-0 place-items-center rounded-[18px] bg-[linear-gradient(160deg,#16161B,#07070A)] shadow-[0_18px_40px_-18px_rgba(217,169,78,0.45),inset_0_0_0_1px_rgba(255,255,255,0.1)]">
          <Emblem sheen className="h-[40px] w-[42px]" />
          <span className="absolute -right-1.5 -top-1.5 grid h-6 min-w-[24px] place-items-center rounded-full bg-[#F6D58E] px-1.5 text-[12px] font-bold text-[#1A1206] shadow-[0_0_0_3px_#0E0E12]">
            2
          </span>
        </span>
        <p className="flex items-center gap-2 text-[12px] leading-snug text-[#8C867F] sm:max-w-[9rem] sm:text-center">
          <Smartphone className="h-3.5 w-3.5 shrink-0 text-[#D9A94E] sm:hidden" />
          On your home screen. No app store needed.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- grid --- */

/**
 * Eight cards. On a desktop the wide ones alternate sides row by row —
 * inbox left, drafts right, follow-ups left, phone right — so the grid reads
 * as a zig-zag rather than a spreadsheet.
 */
export function FeatureBento() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5 lg:[grid-auto-flow:dense]">
      <BentoCard
        icon={Inbox}
        title="One inbox, in Meta’s order"
        body="Instagram DMs and Messenger together, sorted into Needs a reply and Replied. The order you already know, with a draft on every enquiry."
        className="md:col-span-2"
        aside={<DemoTag />}
      >
        <InboxVisual />
      </BentoCard>

      <BentoCard
        icon={Sparkles}
        title="Drafts in your voice"
        aside={<DemoTag />}
        body="It learns from your past replies and every edit you make. Not quite right? Three more takes are one tap away. Go on, try one."
        className="md:col-span-2 lg:col-start-2"
        delay={80}
      >
        <DraftsVisual />
      </BentoCard>

      <BentoCard
        icon={ScanSearch}
        title="Quotes from their photos"
        body="Reads the reference photos for size and placement, then gives a ballpark from your price list. Never a made-up number."
        delay={80}
      >
        <PhotosVisual />
      </BentoCard>

      <BentoCard
        icon={CalendarCheck}
        title="Books from your calendar"
        body="Offers real free times from Google Calendar or Timely, collects the details and asks for a deposit your way."
      >
        <CalendarVisual />
      </BentoCard>

      <BentoCard
        icon={RefreshCw}
        title="Follow-ups that don’t slip"
        aside={<DemoTag />}
        body="Quiet quotes get a nudge a few days later. Fresh work gets an aftercare check-in. Both wait as drafts until you say go."
        className="md:col-span-2"
      >
        <FollowUpsVisual />
      </BentoCard>

      <BentoCard
        icon={HandHeart}
        title="Handled by a person"
        aside={<DemoTag />}
        body="Health questions and personal messages are flagged for you instead of getting an AI reply."
        delay={80}
      >
        <SensitiveVisual />
      </BentoCard>

      <BentoCard
        icon={QrCode}
        title="Posts and an artist gallery"
        body="Schedule Facebook and Instagram posts. Artists add fresh work by scanning a QR code on the studio wall."
      >
        <PostsVisual />
      </BentoCard>

      <BentoCard
        icon={BellRing}
        title="Runs from your phone"
        aside={<DemoTag />}
        body="Install it like an app. A push alert lands the moment an enquiry does, with the draft already written."
        className="md:col-span-2"
        delay={80}
      >
        <PhoneVisual />
      </BentoCard>
    </div>
  );
}
