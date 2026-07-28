import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function Badge({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs",
        className
      )}
      {...props}
    />
  );
}
