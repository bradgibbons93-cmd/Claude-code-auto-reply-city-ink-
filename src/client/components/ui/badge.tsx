import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export function Badge({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("inline-flex items-center rounded border px-2 py-0.5 text-xs", className)}
      {...props}
    />
  );
}
