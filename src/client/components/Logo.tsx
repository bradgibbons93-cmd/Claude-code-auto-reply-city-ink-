import { cn } from "@/lib/utils";

/**
 * The brand marks, drawn as SVG rather than shipped as images so they stay
 * sharp at any size and pick up the current theme colour — the monogram is
 * sepia on white and violet on the dark theme without needing two files.
 */

/** The interlocking IC monogram: a serif C with an I struck through it. */
export function Monogram({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 140"
      className={className}
      fill="none"
      stroke="currentColor"
      role="img"
      aria-label="City Ink monogram"
    >
      {/* C — open to the right, weighted like the brand's serif face. */}
      <path
        d="M74 40 A34 34 0 1 0 74 100"
        strokeWidth="8"
        strokeLinecap="butt"
        transform="rotate(-12 50 70)"
      />
      {/* I — the vertical stroke through the centre, with serif caps. */}
      <line x1="50" y1="10" x2="50" y2="130" strokeWidth="7" />
      <line x1="34" y1="11" x2="66" y2="11" strokeWidth="6" strokeLinecap="round" />
      <line x1="34" y1="129" x2="66" y2="129" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

/** Stacked primary logo — monogram over the wordmark. */
export function LogoStacked({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center", className)}>
      <Monogram className="h-14 w-10 text-sepia" />
      <p className="mt-4 font-display text-[1.1rem] leading-none tracking-[0.3em] text-charcoal">
        CITY INK
      </p>
      <p className="mt-2 text-[0.5rem] uppercase tracking-[0.4em] text-muted-foreground">
        Tattoo Geelong
      </p>
    </div>
  );
}

/**
 * The stamp/badge lockup — monogram ringed by curved text. Used where a
 * page has nothing to show yet, so an empty state still looks deliberate.
 */
export function StampBadge({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-label="City Ink Tattoo Geelong stamp"
    >
      <defs>
        <path id="stamp-top" d="M100,100 m-74,0 a74,74 0 0,1 148,0" fill="none" />
        <path id="stamp-bottom" d="M100,100 m-64,0 a64,64 0 0,0 128,0" fill="none" />
      </defs>

      <circle cx="100" cy="100" r="94" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle
        cx="100"
        cy="100"
        r="78"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity="0.55"
      />

      <text
        fill="currentColor"
        fontFamily="Archivo, system-ui, sans-serif"
        fontSize="19"
        letterSpacing="5"
      >
        <textPath href="#stamp-top" startOffset="50%" textAnchor="middle">
          CITY INK
        </textPath>
      </text>

      <text
        fill="currentColor"
        fontFamily="Archivo, system-ui, sans-serif"
        fontSize="11"
        letterSpacing="4"
        opacity="0.85"
      >
        <textPath href="#stamp-bottom" startOffset="50%" textAnchor="middle">
          TATTOO GEELONG
        </textPath>
      </text>

      {/* The two dots that separate the upper and lower text on the badge. */}
      <circle cx="17" cy="100" r="2.6" fill="currentColor" />
      <circle cx="183" cy="100" r="2.6" fill="currentColor" />

      <g transform="translate(70, 55) scale(0.43)">
        <g fill="none" stroke="currentColor">
          <path
            d="M74 40 A34 34 0 1 0 74 100"
            strokeWidth="8"
            transform="rotate(-12 50 70)"
          />
          <line x1="50" y1="10" x2="50" y2="130" strokeWidth="7" />
          <line x1="34" y1="11" x2="66" y2="11" strokeWidth="6" strokeLinecap="round" />
          <line x1="34" y1="129" x2="66" y2="129" strokeWidth="6" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}
