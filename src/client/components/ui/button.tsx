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
        "inline-flex items-center justify-center rounded-md text-sm transition-colors disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "h-8 px-3" : "h-10 px-4",
        variant === "default" && "bg-amber-500 text-black hover:bg-amber-600",
        variant === "ghost" && "hover:bg-white/5",
        variant === "outline" && "border border-amber-500/30 text-amber-400 hover:bg-amber-500/10",
        className
      )}
      {...props}
    />
  );
}
