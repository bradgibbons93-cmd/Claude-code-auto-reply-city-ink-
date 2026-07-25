import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-md border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
