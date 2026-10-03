import type { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { previewStyle } from "@/lib/themes";

/**
 * Runnit's own surface — sign up, log in and first-time setup.
 *
 * It wears the Noir & Gold theme by scoping those variables to this box, so
 * every shared component inside (buttons, inputs, the image picker, the
 * dashboard preview) comes out in Runnit's black and gold without a second
 * set of styles, whatever look the studio later chooses for itself.
 */
export function RunnitShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("relative isolate min-h-[100dvh] overflow-x-hidden font-runnit", className)}
      style={{ ...previewStyle({ theme: "noir", mode: "dark" }), fontFamily: `"Inter Tight", system-ui, sans-serif` }}
    >
      {/* A warm glow and a hairline ring — the emblem's light, very quietly. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(217,169,78,0.18),transparent)]" />
        <div className="absolute -bottom-56 -right-40 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(closest-side,rgba(154,100,36,0.14),transparent)]" />
        <div className="absolute left-1/2 top-24 h-[44rem] w-[44rem] -translate-x-1/2 rounded-full border border-white/[0.04]" />
      </div>
      {children}
    </div>
  );
}

export function RunnitLogo({ className, link = true }: { className?: string; link?: boolean }) {
  const mark = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <img src="/brand/runnit-emblem.png" alt="" className="h-8 w-8 object-contain" />
      <img src="/brand/runnit-wordmark.png" alt="Runnit" className="h-[18px] w-auto object-contain" />
    </span>
  );
  return link ? (
    <Link href="/" className="rounded-lg focus-visible:outline-offset-4" aria-label="Runnit home">
      {mark}
    </Link>
  ) : (
    mark
  );
}

/** The gold call to action used across Runnit's own screens. */
export function GoldButton({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "relative inline-flex min-h-[48px] items-center justify-center gap-2 overflow-hidden rounded-full px-6 text-sm font-semibold text-[#1a1206] shadow-[0_10px_30px_-12px_rgba(217,169,78,0.7)] transition-all duration-300",
        "bg-[linear-gradient(135deg,#F6D58E_0%,#D9A94E_45%,#B07A2E_100%)] hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-14px_rgba(217,169,78,0.85)] active:translate-y-0",
        "disabled:pointer-events-none disabled:opacity-60",
        className
      )}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  // The hint can hold a button ("Forgot it?"), and a button inside a <label>
  // steals the label — it becomes the thing "Password" names, so tapping the
  // word focused the link and screen readers read the button as the field.
  // The label wraps only the control; the visible heading and hint sit beside it.
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span aria-hidden="true" className="text-sm font-medium text-charcoal">
          {label}
        </span>
        {hint && <span className="text-[0.7rem] text-muted-foreground">{hint}</span>}
      </div>
      <label className="block">
        <span className="sr-only">{label}</span>
        {children}
      </label>
      {error && (
        <span role="alert" className="block text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

export const inputClass =
  "block w-full min-h-[48px] rounded-xl border border-border bg-input px-4 text-[15px] text-charcoal placeholder:text-muted-foreground/70 outline-none transition focus:border-sepia focus:ring-4 focus:ring-sepia/15";
