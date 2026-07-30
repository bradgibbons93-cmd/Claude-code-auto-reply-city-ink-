import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

/**
 * Ink spreads from wherever the cursor is, rather than from the middle.
 * The position is written straight to a CSS variable on the element — no
 * state, so moving the mouse doesn't re-render the card or anything in it.
 */
export function Card({ className, onMouseMove, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("ink-hover lift rounded-2xl border border-border bg-card shadow-soft", className)}
      onMouseMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty("--mx", `${event.clientX - box.left}px`);
        event.currentTarget.style.setProperty("--my", `${event.clientY - box.top}px`);
        onMouseMove?.(event);
      }}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pb-2", className)} {...props} />;
}
export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("font-display text-base tracking-[0.08em] text-charcoal", className)}
      {...props}
    />
  );
}
export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
