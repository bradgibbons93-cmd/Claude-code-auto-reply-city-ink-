import { cn } from "@/lib/utils";

/**
 * Initials rather than photos. Messenger profile pictures need the
 * user_profile permission through App Review, and the URLs Facebook returns
 * expire — so until that's approved this is the honest version rather than
 * a broken image.
 */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
        "bg-beige/40 text-xs font-medium text-charcoal",
        className
      )}
    >
      {initials || "?"}
    </div>
  );
}
