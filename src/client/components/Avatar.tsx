import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A profile picture when Meta gives us one, initials when it doesn't.
 *
 * It usually doesn't. The per-person lookup is refused for this app and
 * always has been, and Instagram only offers a picture through the
 * conversations edge, which times out on this account. So initials are the
 * normal case, not the fallback of last resort — and a broken image icon
 * would look like a bug in the dashboard rather than a limit of the API.
 *
 * Meta's picture URLs also expire, which is the other reason this can't just
 * trust `src`: when one 404s we drop back to initials rather than leave a
 * torn image on the board.
 */
export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  const initials = name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const base = cn(
    "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full",
    "bg-beige/40 text-xs font-medium text-charcoal",
    className
  );

  if (src && !broken) {
    return (
      <img
        src={src}
        alt={name}
        loading="lazy"
        onError={() => setBroken(true)}
        className={cn(base, "object-cover")}
      />
    );
  }

  return <div className={base}>{initials || "?"}</div>;
}
