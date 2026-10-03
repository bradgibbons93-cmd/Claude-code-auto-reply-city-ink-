import type { CSSProperties } from "react";
import { Check, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { applyArt, type ArtMode } from "@/lib/art";

export { applyArt, type ArtMode };


/**
 * One of the Home's 3D illustrations: the rose bubble, the tattoo machine,
 * the calendar, the camera. They were drawn black and gold for the Ink look,
 * and on every other theme they sat there in black and gold anyway.
 *
 * Brad, 2 October: "I want an option to remove the little png black images
 * we added. Or even better, they should change colour along with the colour
 * of the theme or just black or white." So how they're drawn is the studio's
 * choice, set on <html data-art> from the studio record (see session.tsx)
 * and painted in index.css:
 *   theme (default) – greyscale, then tinted with the theme's accent
 *   gold            – as drawn
 *   mono            – black and white
 *   off             – not drawn at all
 *
 * Positioning and animation classes go on `className`, exactly as they used
 * to go on the <img>. `mode` pins one picture to a style regardless of the
 * studio's setting — only the picker in Settings uses it.
 */
export function Art({
  src,
  className,
  imgClassName,
  mode,
  style,
}: {
  src: string;
  className?: string;
  imgClassName?: string;
  mode?: ArtMode;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      data-art-self={mode}
      className={cn("rn-art pointer-events-none", className)}
      // Absolute on purpose: a url() inside a custom property resolves
      // against the stylesheet that USES it, not this page — so a relative
      // path (the test drive's are) pointed the tint's mask at nothing.
      style={{ ...style, ["--art" as string]: `url("${absolute(src)}")` }}
    >
      <img src={src} alt="" draggable={false} className={imgClassName} />
    </span>
  );
}

function absolute(src: string) {
  try {
    return new URL(src, document.baseURI).href;
  } catch {
    return src;
  }
}

const OPTIONS: Array<{ id: ArtMode; title: string; body: string }> = [
  { id: "theme", title: "Match my theme", body: "Tinted to your theme's colour. Change the theme and they follow." },
  { id: "gold", title: "Gold", body: "As they were drawn, black and gold." },
  { id: "mono", title: "Black & white", body: "No colour at all." },
  { id: "off", title: "Hide them", body: "Just the screens, no illustrations or flash sheet." },
];

/** Settings → Appearance → Illustrations. */
export function ArtPicker() {
  const { studio, refresh } = useSession();
  const save = trpc.studios.setAppearance.useMutation({
    onError: (error) => {
      applyArt(studio?.art);
      toast.error(error.message);
    },
  });
  const current: ArtMode = (studio?.art as ArtMode) ?? "theme";
  const choose = (id: ArtMode) => {
    if (!studio || id === current) return;
    applyArt(id); // show it straight away; the save catches up
    save.mutate({ id: studio.id, art: id }, { onSuccess: () => refresh() });
  };
  return (
    <div role="radiogroup" aria-label="Illustrations" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {OPTIONS.map(({ id, title, body }) => {
        const on = current === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={save.isPending}
            onClick={() => choose(id)}
            className={cn(
              "flex min-h-[44px] flex-col items-start gap-2 rounded-2xl border p-3 text-left transition-colors disabled:opacity-60",
              on ? "border-sepia bg-sepia/10" : "border-border bg-card hover:border-sepia/60"
            )}
          >
            <span className="relative grid h-16 w-full place-items-center rounded-xl bg-elevated">
              {id === "off" ? (
                <EyeOff className="h-6 w-6 text-muted-foreground" />
              ) : (
                <Art src="/home/reply.webp" mode={id} className="relative h-14 w-14" />
              )}
            </span>
            <span className="flex items-center gap-1.5 text-sm font-semibold text-charcoal">
              {title}
              {on && <Check className="h-4 w-4 text-sepia" />}
            </span>
            <span className="text-xs leading-snug text-muted-foreground">{body}</span>
          </button>
        );
      })}
    </div>
  );
}
