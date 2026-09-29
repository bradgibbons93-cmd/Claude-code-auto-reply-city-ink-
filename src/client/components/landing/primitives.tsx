import { useId, type ReactNode, type SVGProps } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

/** Page gutter: 16px on a phone, widening with the screen. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#D9A94E]",
        className
      )}
    >
      <span aria-hidden className="h-px w-6 bg-gradient-to-r from-transparent to-[#D9A94E]" />
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
  align = "left",
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  id?: string;
  align?: "left" | "center";
  className?: string;
}) {
  return (
    <div className={cn(align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl", className)}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        id={id}
        className="mt-4 text-balance text-[32px] font-semibold leading-[1.06] tracking-[-0.035em] text-[#F4F1EA] sm:text-[44px] lg:text-[52px]"
      >
        {title}
      </h2>
      {lead ? (
        <p className="mt-4 text-pretty text-[16px] leading-relaxed text-[#A6A09A] sm:mt-5 sm:text-[18px]">{lead}</p>
      ) : null}
    </div>
  );
}

type Size = "sm" | "md" | "lg";
const SIZES: Record<Size, string> = {
  sm: "h-11 px-4 text-[14px] rounded-full",
  md: "h-12 px-6 text-[15px] rounded-full",
  lg: "h-[54px] px-7 text-[16px] rounded-full",
};

/** The one thing on screen that means "press this". Routes through wouter. */
export function GoldLink({
  href,
  children,
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  size?: Size;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rn-btn-gold inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold tracking-[-0.01em]",
        SIZES[size],
        className
      )}
    >
      {children}
    </Link>
  );
}

export function GhostLink({
  href,
  children,
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  size?: Size;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rn-btn-ghost inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium text-[#F4F1EA]",
        SIZES[size],
        className
      )}
    >
      {children}
    </Link>
  );
}

/** Tiny "this is made up" tag for every mock that shows customer data. */
export function DemoTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-2 py-[3px] text-[9.5px] font-medium uppercase tracking-[0.16em] text-[#8C867F]",
        className
      )}
    >
      Demo
    </span>
  );
}

/* ---------------------------------------------------------------- marks -- */

export function Emblem({ className, sheen = false }: { className?: string; sheen?: boolean }) {
  return (
    <span className={cn("relative inline-block", className)}>
      <img src="/brand/runnit-emblem.png" alt="" width={460} height={431} className="h-full w-full object-contain" draggable={false} />
      {sheen ? <span aria-hidden className="rn-emblem-sheen" /> : null}
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/runnit-wordmark.png"
      alt="Runnit"
      width={560}
      height={88}
      className={cn("w-auto select-none", className)}
      draggable={false}
    />
  );
}

/* ------------------------------------------------------ platform badges -- */

/** Instagram, drawn rather than imported, so it stays crisp at 12px. */
export function IgBadge({ className }: { className?: string }) {
  return (
    <span
      aria-label="Instagram"
      role="img"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-[5px] bg-[linear-gradient(45deg,#F4B147_0%,#E1306C_45%,#8A3AB9_100%)] ring-2 ring-[#0C0C10]",
        className ?? "h-4 w-4"
      )}
    >
      <svg viewBox="0 0 16 16" className="h-[70%] w-[70%]" fill="none" stroke="#fff" strokeWidth="1.6">
        <rect x="2.5" y="2.5" width="11" height="11" rx="3.4" />
        <circle cx="8" cy="8" r="2.6" />
        <circle cx="11.4" cy="4.6" r=".6" fill="#fff" stroke="none" />
      </svg>
    </span>
  );
}

export function MessengerBadge({ className }: { className?: string }) {
  return (
    <span
      aria-label="Messenger"
      role="img"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-[linear-gradient(200deg,#FF6A68_0%,#A033FF_45%,#0A7CFF_100%)] ring-2 ring-[#0C0C10]",
        className ?? "h-4 w-4"
      )}
    >
      <svg viewBox="0 0 16 16" className="h-[72%] w-[72%]" fill="#fff">
        <path d="M3.4 10.4 6.3 6l2 1.6L11.1 6 8.2 10.4 6.2 8.8z" />
      </svg>
    </span>
  );
}

export function FacebookBadge({ className }: { className?: string }) {
  return (
    <span
      aria-label="Facebook"
      role="img"
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#1877F2] ring-2 ring-[#0C0C10]",
        className ?? "h-4 w-4"
      )}
    >
      <svg viewBox="0 0 16 16" className="h-full w-full" fill="#fff">
        <path d="M10.6 16V10h1.9l.3-2.3h-2.2V6.3c0-.7.2-1.1 1.1-1.1h1.2V3.1c-.2 0-.9-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.6H6.2V10h1.9v6z" />
      </svg>
    </span>
  );
}

const AVATAR_TONES = [
  "from-[#4A3A2E] to-[#2A211B]",
  "from-[#34394A] to-[#1D2029]",
  "from-[#4A3340] to-[#261A21]",
  "from-[#2F4038] to-[#1A231F]",
  "from-[#473F2B] to-[#26211A]",
];

export function Avatar({
  initials,
  tone = 0,
  platform,
  className,
}: {
  initials: string;
  tone?: number;
  platform?: "ig" | "fb";
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className ?? "h-10 w-10")}>
      <span
        aria-hidden
        className={cn(
          "grid h-full w-full place-items-center rounded-full bg-gradient-to-br text-[12px] font-semibold tracking-wide text-[#F4F1EA] ring-1 ring-inset ring-white/10",
          AVATAR_TONES[tone % AVATAR_TONES.length]
        )}
      >
        {initials}
      </span>
      {platform === "ig" ? <IgBadge className="absolute -bottom-0.5 -right-0.5 h-[15px] w-[15px]" /> : null}
      {platform === "fb" ? <MessengerBadge className="absolute -bottom-0.5 -right-0.5 h-[15px] w-[15px]" /> : null}
    </span>
  );
}

/* ------------------------------------------------------------ linework -- */

/**
 * A stencil ring — the emblem's circle and compass points, drawn in hairline
 * gold. Used big and faint behind the hero and the closing call to action.
 */
export function StencilRing(props: SVGProps<SVGSVGElement>) {
  const ticks = Array.from({ length: 72 }, (_, i) => i * 5);
  const gid = `rn-ring-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 400 400" fill="none" aria-hidden {...props}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="400" y2="400" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F6D58E" />
          <stop offset=".5" stopColor="#D9A94E" />
          <stop offset="1" stopColor="#9A6424" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${gid})`}>
        <circle cx="200" cy="200" r="196" strokeWidth=".6" strokeOpacity=".5" />
        <circle cx="200" cy="200" r="168" strokeWidth=".5" strokeOpacity=".35" strokeDasharray="1 5" />
        <circle cx="200" cy="200" r="120" strokeWidth=".5" strokeOpacity=".25" />
        {ticks.map((deg) => (
          <line
            key={deg}
            x1="200"
            y1={deg % 45 === 0 ? 4 : 10}
            x2="200"
            y2="18"
            strokeWidth={deg % 45 === 0 ? 0.9 : 0.5}
            strokeOpacity={deg % 45 === 0 ? 0.7 : 0.3}
            transform={`rotate(${deg} 200 200)`}
          />
        ))}
      </g>
      <g fill={`url(#${gid})`} fillOpacity=".55">
        <path d="M200 0 203 22 200 30 197 22Z" />
        <path d="M200 400 203 378 200 370 197 378Z" />
      </g>
    </svg>
  );
}

/** Fine-line flower, the kind of flash a reference photo usually carries. */
export function PeonyLineArt(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 60 84" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M30 33c-6.2 0-10.4-3.8-10.4-8.8S24.6 15 30 15s10.4 4.2 10.4 9.2S36.2 33 30 33Z" />
      <path d="M30 33c-3.3-1.6-4.6-4.6-3.9-8.2M30 33c3.3-1.6 4.6-4.6 3.9-8.2M26.4 21c1.1-2 2.4-3.2 3.6-3.6 1.2.4 2.5 1.6 3.6 3.6" />
      <path d="M19.8 24.6c-5.6-.6-9.6 2.4-10.2 7.6 5 3.6 13.4 3.8 20.4.8" />
      <path d="M40.2 24.6c5.6-.6 9.6 2.4 10.2 7.6-5 3.6-13.4 3.8-20.4.8" />
      <path d="M22 16.8c-1.4-3.8.2-7.2 3.4-8.8 1.6 1 3.4 3 4.6 5.4 1.2-2.4 3-4.4 4.6-5.4 3.2 1.6 4.8 5 3.4 8.8" />
      <path d="M30 33.4V78" />
      <path d="M30 52c-6.8-.4-11.8-4.6-12.8-11 6.8.2 11.4 4.2 12.8 11Z" />
      <path d="M30 62.5c6.8-.4 11.8-4.6 12.8-11-6.8.2-11.4 4.2-12.8 11Z" />
      <path d="M30 70c-4-.8-6.6-3.2-7.2-6.6" />
    </svg>
  );
}
