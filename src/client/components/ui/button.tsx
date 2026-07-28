import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "ghost" | "outline";
  size?: "default" | "sm";
  asChild?: boolean;
}

export function Button({ className, variant = "default", size = "default", asChild, ...props }: Props) {
  void asChild;
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl text-sm font-medium transition-all duration-300",
        "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-3" : "h-10 px-4",
        variant === "default" &&
          "bg-charcoal text-white shadow-soft hover:bg-charcoal/90 hover:shadow-lift",
        variant === "ghost" && "text-charcoal hover:bg-beige/25",
        variant === "outline" && "border border-border text-charcoal hover:border-sepia hover:bg-beige/20",
        className
      )}
      {...props}
    />
  );
}
