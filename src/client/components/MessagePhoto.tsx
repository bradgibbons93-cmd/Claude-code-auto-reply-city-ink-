import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A photo someone sent, as a tile — and an honest tile when it's gone.
 *
 * When a photo arrives the app tries to keep its own copy. If that failed at
 * the time, all that is stored is Instagram's or Facebook's link, and those
 * links die after a few days. The browser then drew its broken-image "?" in
 * the middle of the card, which reads as the app being broken. It isn't: the
 * picture simply no longer exists anywhere we can reach. So say that, keep the
 * tile (a photo WAS sent, and that matters when pricing), and don't offer to
 * open a picture that won't open.
 */
export function MessagePhoto({
  src,
  alt,
  className,
  onOpen,
}: {
  src: string;
  alt: string;
  /** Size and shape, shared by the picture and the expired tile. */
  className: string;
  onOpen?: () => void;
}) {
  const [gone, setGone] = useState(false);

  if (gone) {
    return (
      <span
        role="img"
        aria-label="Photo no longer available"
        title="This photo's link has expired — open the chat in Instagram or Messenger to see it"
        className={cn(
          className,
          "flex flex-col items-center justify-center gap-1 border border-dashed border-border bg-surface text-muted-foreground"
        )}
      >
        <ImageOff className="h-4 w-4" />
        <span className="px-1 text-center text-[0.6rem] leading-tight">Photo expired</span>
      </span>
    );
  }

  const img = (
    <img src={src} alt={alt} className={className} loading="lazy" onError={() => setGone(true)} />
  );

  if (!onOpen) return img;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {img}
    </button>
  );
}
