import { cn } from "@/lib/utils";
import badge from "@/assets/badge.png";
import badge2x from "@/assets/badge@2x.png";

/**
 * The City Ink marks.
 *
 * StampBadge is the studio's real artwork, shipped as an image — it is the
 * mark to reach for. The drawn wordmark and IC submark below it exist for the
 * places the badge's fine ring text would turn to mush: inline at text size,
 * or anywhere the mark has to take the theme colour rather than sit on its
 * own white plate.
 */

/** Organic edge filter — turbulence displacement, the way ink bleeds. */
export function InkDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <filter id="ink-bleed" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7">
            <animate
              attributeName="baseFrequency"
              dur="20s"
              values="0.03;0.045;0.03"
              repeatCount="indefinite"
            />
          </feTurbulence>
          <feDisplacementMap
            in="SourceGraphic"
            scale="1.6"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

/**
 * The IC submark — a Didone C with the I struck through it, interlocking.
 */
export function Monogram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 130"
      className={className}
      fill="currentColor"
      role="img"
      aria-label="City Ink"
    >
      {/*
        Paths, not type — glyph metrics shift with whichever serif loads, and
        at sidebar size that drift clipped the C.

        The C is a filled crescent rather than a stroked arc so it carries the
        thick/thin contrast of the sheet's Didone: heavy through the left
        flank, tapering to hairline terminals top and bottom.
      */}
      <path
        d="M70 42
           A30 34 0 1 0 70 88
           L70 79
           A22 26 0 1 1 70 51
           Z"
      />
      {/* The I runs taller than the C and crosses its counter, with the slab
          serifs that give the mark its weight. */}
      <rect x="45.5" y="18" width="6" height="94" />
      <rect x="34" y="18" width="29" height="5.5" />
      <rect x="34" y="106.5" width="29" height="5.5" />
    </svg>
  );
}

/** The wordmark alone — CITY INK over TATTOO GEELONG. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center", className)}>
      <p className="font-display text-[1.6rem] font-normal leading-none tracking-[0.22em] text-charcoal">
        CITY INK
      </p>
      <p className="mt-2 text-[0.5rem] uppercase tracking-[0.42em] text-muted-foreground">
        Tattoo Geelong
      </p>
    </div>
  );
}

/**
 * The primary lockup: wordmark, then a rule broken by the gold submark.
 * `ink` softens the edges for hero placements.
 */
export function LogoStacked({ className, ink = false }: { className?: string; ink?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center", className)}>
      <Wordmark />
      <div className="mt-3 flex w-full items-center gap-3">
        <span className="h-px flex-1 bg-sepia/50" />
        <Monogram
          className={cn("h-7 w-6 text-sepia", ink && "logo-glow")}
          {...(ink ? { filter: "url(#ink-bleed)" } : {})}
        />
        <span className="h-px flex-1 bg-sepia/50" />
      </div>
    </div>
  );
}

/**
 * The studio's actual badge artwork, cut out of its white plate so it sits on
 * any background. This is the real mark — everything drawn below it is only
 * used where the badge would be too detailed to read.
 *
 * `ink` adds the breathing glow used on hero placements.
 */
export function StampBadge({ className, ink = false }: { className?: string; ink?: boolean }) {
  return (
    <img
      src={badge}
      srcSet={`${badge} 1x, ${badge2x} 2x`}
      alt="City Ink Tattoo Geelong"
      className={cn("select-none object-contain", ink && "logo-glow", className)}
      draggable={false}
    />
  );
}

/**
 * A slow ink drip. Purely decorative — sits behind headers to give the page
 * movement without competing for attention.
 */
export function InkDrip({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 200"
      className={className}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path className="ink-drip-path" d="M60 0 C 74 40, 46 62, 60 96 C 72 124, 50 140, 60 168" />
    </svg>
  );
}
