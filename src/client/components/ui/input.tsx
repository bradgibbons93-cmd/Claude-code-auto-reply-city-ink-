import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-xl border border-border bg-input px-3.5 py-2 text-sm text-foreground",
        "transition-all duration-300 placeholder:text-muted-foreground",
        "focus:border-sepia/60 focus:shadow-glow focus:outline-none",
        className
      )}
      {...props}
    />
  );
}
