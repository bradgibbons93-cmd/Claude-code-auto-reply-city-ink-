import { cn } from "@/lib/utils";
import type { TextareaHTMLAttributes } from "react";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex w-full rounded-xl border border-border bg-input px-3.5 py-2.5 text-sm text-foreground",
        "transition-all duration-300 placeholder:text-muted-foreground",
        "focus:border-sepia/60 focus:shadow-glow focus:outline-none",
        className
      )}
      {...props}
    />
  );
}
