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
 * The IC submark — a serif C with the I struck through it, the two
 * interlocking. Set as type so it inherits the loaded serif rather than
 * approximating the curves with paths.
 */
export function Monogram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 130"
      className={className}
      fill="none"
      stroke="currentColor"
      role="img"
      aria-label="City Ink"
    >
      {/* Drawn as paths rather than set as type: glyph metrics vary with
          whichever serif actually loads, and at this size a few pixels of
          drift clipped the C. */}
      <path d="M78 38 A32 32 0 1 0 78 92" strokeWidth="7" strokeLinecap="butt" />
      {/* The I sits left of the C's centre and runs taller, as on the sheet. */}
      <line x1="42" y1="16" x2="42" y2="114" strokeWidth="6" />
      <line x1="29" y1="17" x2="55" y2="17" strokeWidth="5" />
      <line x1="29" y1="113" x2="55" y2="113" strokeWidth="5" />
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
          fontFamily="'Cormorant Garamond', Georgia, serif"
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
