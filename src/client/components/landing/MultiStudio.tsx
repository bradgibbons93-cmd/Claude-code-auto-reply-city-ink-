import { useState, type CSSProperties } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { DemoTag } from "./primitives";

/**
 * A working miniature of the studio switcher. The studios are invented; tapping
 * one re-themes the preview beside it, which says "each location keeps its own
 * look" faster than a sentence can.
 */

type Theme = {
  bg: string;
  surface: string;
  accent: string;
  onAccent: string;
  text: string;
  muted: string;
  font: string;
  upper: boolean;
};

const STUDIOS: Array<{ id: string; name: string; place: string; mono: string; theme: Theme }> = [
  {
    id: "brunswick",
    name: "Northside Ink",
    place: "Brunswick",
    mono: "NI",
    theme: {
      bg: "#100F0D",
      surface: "#1A1814",
      accent: "#E9DBBC",
      onAccent: "#15130F",
      text: "#F4EEE2",
      muted: "#9D9485",
      font: "'Bodoni Moda', Didot, Georgia, serif",
      upper: true,
    },
  },
  {
    id: "fitzroy",
    name: "Northside Ink",
    place: "Fitzroy",
    mono: "NI",
    theme: {
      bg: "#0B1110",
      surface: "#121A18",
      accent: "#A9D4C0",
      onAccent: "#0B1110",
      text: "#EAF2EE",
      muted: "#8A9C95",
      font: "Syne, 'Inter Tight', system-ui, sans-serif",
      upper: true,
    },
  },
  {
    id: "hollow-moon",
    name: "Hollow Moon Tattoo",
    place: "Ballarat",
    mono: "HM",
    theme: {
      bg: "#150B0C",
      surface: "#211314",
      accent: "#E8A08A",
      onAccent: "#1C0E0E",
      text: "#F7ECE7",
      muted: "#A98F89",
      font: "Fraunces, Georgia, serif",
      upper: false,
    },
  },
];

const T = "transition-[color,background-color,border-color,box-shadow] duration-500";

export function StudioSwitcherDemo() {
  const [activeId, setActiveId] = useState(STUDIOS[0].id);
  const active = STUDIOS.find((s) => s.id === activeId) ?? STUDIOS[0];
  const t = active.theme;

  return (
    <div className="rn-card rounded-[28px] p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        {/* The switcher, drawn open */}
        <div className="rn-inset rounded-2xl p-2">
          <div className="flex min-h-[52px] items-center gap-2.5 rounded-xl bg-white/[0.05] px-3 py-2 ring-1 ring-inset ring-white/10">
            <Mono studio={active} small />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold leading-tight text-[#F4F1EA]">{active.name}</span>
              <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-[#A6A09A]">{active.place}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 rotate-180 text-[#A6A09A]" />
          </div>
          <p className="px-2 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#6F6A64]">
            Your studios
          </p>
          <div role="group" aria-label="Example studios — pick one to preview its theme" className="space-y-0.5">
            {STUDIOS.map((s) => {
              const on = s.id === activeId;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setActiveId(s.id)}
                  className={cn(
                    "flex min-h-[48px] w-full items-center gap-2.5 rounded-xl px-2.5 text-left transition-colors",
                    on ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"
                  )}
                >
                  <Mono studio={s} small />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium leading-tight text-[#F4F1EA]">{s.name}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] leading-tight text-[#8C867F]">{s.place}</span>
                  </span>
                  {on ? <Check className="h-4 w-4 shrink-0 text-[#F6D58E]" strokeWidth={2.4} /> : null}
                </button>
              );
            })}
          </div>
          <div aria-hidden className="mt-1 flex min-h-[44px] items-center gap-2.5 border-t border-white/[0.06] px-2.5 pt-1 text-[12.5px] text-[#8C867F]">
            <span className="grid h-7 w-7 place-items-center rounded-lg border border-dashed border-white/15">
              <Plus className="h-3.5 w-3.5" />
            </span>
            Add a studio
          </div>
        </div>

        {/* That studio’s own dashboard, in its own colours */}
        <div
          aria-hidden
          className={cn("relative overflow-hidden rounded-2xl border p-4 sm:p-5", T)}
          style={{ backgroundColor: t.bg, borderColor: `${t.accent}33` }}
        >
          <div
            aria-hidden
            className={cn("pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl", T)}
            style={{ backgroundColor: `${t.accent}22` }}
          />
          <div className="relative flex items-center gap-3">
            <Mono studio={active} />
            <div className="min-w-0">
              <p
                className={cn("truncate text-[17px] leading-tight", T, t.upper && "uppercase tracking-[0.14em]")}
                style={{ color: t.text, fontFamily: t.font, fontWeight: 600 }}
              >
                {active.name}
              </p>
              <p className={cn("text-[12px]", T)} style={{ color: t.muted }}>
                {active.place}
              </p>
            </div>
          </div>

          <div className="relative mt-5 flex items-center justify-between">
            <p className={cn("text-[11px] font-semibold uppercase tracking-[0.16em]", T)} style={{ color: t.muted }}>
              Needs a reply
            </p>
            <span
              className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", T)}
              style={{ backgroundColor: t.accent, color: t.onAccent }}
            >
              2
            </span>
          </div>
          <ul className="relative mt-2.5 space-y-2">
            {[
              { i: "CH", n: "Chloe H.", p: "Chloe sent 2 photos." },
              { i: "MR", n: "Mason R.", p: "Half sleeve, black and grey?" },
            ].map((r) => (
              <li
                key={r.n}
                className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2.5", T)}
                style={{ backgroundColor: t.surface }}
              >
                <span
                  className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold", T)}
                  style={{ backgroundColor: `${t.accent}26`, color: t.text }}
                >
                  {r.i}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[13px] font-semibold", T)} style={{ color: t.text }}>
                    {r.n}
                  </span>
                  <span className={cn("block truncate text-[12px]", T)} style={{ color: t.muted }}>
                    {r.p}
                  </span>
                </span>
                <span
                  className={cn("hidden shrink-0 rounded-full px-2 py-[3px] text-[10px] font-semibold min-[400px]:inline", T)}
                  style={{ color: t.accent, boxShadow: `inset 0 0 0 1px ${t.accent}55` }}
                >
                  Draft ready
                </span>
              </li>
            ))}
          </ul>
          <div
            className={cn("relative mt-4 flex h-11 items-center justify-center rounded-full text-[13px] font-semibold", T)}
            style={{ backgroundColor: t.accent, color: t.onAccent }}
          >
            Approve &amp; send
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 px-1">
        <p className="text-[12px] text-[#8C867F]">Tap a studio to switch.</p>
        <DemoTag />
      </div>
    </div>
  );
}

function Mono({ studio, small = false }: { studio: (typeof STUDIOS)[number]; small?: boolean }) {
  const t = studio.theme;
  const style: CSSProperties = {
    backgroundColor: t.bg,
    color: t.accent,
    boxShadow: `inset 0 0 0 1px ${t.accent}66`,
    fontFamily: t.font,
  };
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center font-semibold",
        T,
        small ? "h-7 w-7 rounded-lg text-[10px]" : "h-11 w-11 rounded-xl text-[14px]",
        t.upper && "tracking-[0.06em]"
      )}
      style={style}
    >
      {studio.mono}
    </span>
  );
}
