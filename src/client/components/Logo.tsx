import { cn } from "@/lib/utils";

/**
 * The City Ink marks, from the studio's logo sheet.
 *
 * The brand is a high-contrast serif wordmark — CITY INK widely tracked over
 * TATTOO GEELONG — with the interlocking IC submark in gold (#C6A47D). Drawn
 * rather than shipped as images so they stay sharp at any size and take the
 * theme colour: black on the light theme, violet-lit on the dark one.
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
 * The badge for empty states — the submark ringed, so a page with nothing in
 * it still looks deliberate rather than broken.
 */
export function StampBadge({ className, ink = false }: { className?: string; ink?: boolean }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-label="City Ink Tattoo Geelong"
    >
      <g filter={ink ? "url(#ink-bleed)" : undefined}>
        <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle
          cx="100"
          cy="100"
          r="84"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.75"
          opacity="0.5"
        />

        <text
          x="100"
          y="88"
          textAnchor="middle"
          fill="currentColor"
          fontFamily="'Bodoni Moda', Didot, Georgia, serif"
          fontSize="30"
          letterSpacing="5"
        >
          CITY INK
        </text>

        <line
          x1="56"
          y1="102"
          x2="144"
          y2="102"
          stroke="currentColor"
          strokeWidth="0.75"
          opacity="0.6"
        />

        <text
          x="100"
          y="122"
          textAnchor="middle"
          fill="currentColor"
          fontFamily="Montserrat, system-ui, sans-serif"
          fontSize="9"
          letterSpacing="4.5"
          opacity="0.85"
        >
          TATTOO GEELONG
        </text>
      </g>
    </svg>
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
