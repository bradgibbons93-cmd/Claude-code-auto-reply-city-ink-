import { useRef, useState, type DragEvent } from "react";
import { ImagePlus, Loader2, RefreshCw, Trash2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { prepareImage, uploadBrandImage, UploadProblem, type BrandKind } from "@/lib/uploadImage";

/**
 * Pick, drop or replace one image — a logo, a banner or a profile photo.
 *
 * It uploads the moment a file is chosen and hands back where it was stored;
 * the caller saves that against the studio or the account. Nothing here is
 * pretend: the preview is the stored image as the server returns it.
 */
export function ImageDrop({
  kind,
  label,
  hint,
  value,
  shape = "square",
  onUploaded,
  onRemove,
  className,
}: {
  kind: BrandKind;
  label: string;
  hint?: string;
  value: string | null | undefined;
  shape?: "circle" | "square" | "wide";
  onUploaded: (asset: { id: string; url: string }) => Promise<unknown> | void;
  onRemove?: () => Promise<unknown> | void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const busy = progress !== null;

  const take = async (file: File | undefined) => {
    if (!file || busy) return;
    setError(null);
    setProgress(0);
    try {
      const dataUrl = await prepareImage(file, kind);
      const asset = await uploadBrandImage(kind, dataUrl, (f) => setProgress(Math.min(0.95, f)));
      setProgress(1);
      await onUploaded(asset);
    } catch (problem) {
      setError(problem instanceof UploadProblem ? problem.message : "The upload didn't go through. Try again.");
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void take(event.dataTransfer.files?.[0]);
  };

  const frame =
    shape === "circle"
      ? "h-24 w-24 rounded-full"
      : shape === "wide"
        ? "aspect-[3/1] w-full rounded-2xl"
        : "h-24 w-24 rounded-2xl";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-charcoal">{label}</p>
        {hint && <p className="text-[0.7rem] text-muted-foreground">{hint}</p>}
      </div>

      <div className={cn("flex gap-4", shape === "wide" ? "flex-col" : "items-center")}>
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          disabled={busy}
          aria-label={value ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
          className={cn(
            "group relative shrink-0 overflow-hidden border border-dashed transition-all duration-300",
            frame,
            dragging
              ? "scale-[1.02] border-sepia bg-sepia/10"
              : value
                ? "border-transparent"
                : "border-border bg-surface hover:border-sepia/70 hover:bg-beige/10"
          )}
        >
          {value ? (
            <img
              src={value}
              alt=""
              className={cn("h-full w-full", kind === "logo" ? "object-contain p-2" : "object-cover")}
            />
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
              <ImagePlus className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" />
              <span className="text-[0.65rem]">{shape === "wide" ? "Tap or drop an image" : "Add"}</span>
            </span>
          )}

          {busy && (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-sm">
              <Loader2 className="h-5 w-5 animate-spin text-sepia" />
              <span className="h-1 w-3/5 overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full rounded-full bg-sepia transition-[width] duration-200"
                  style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
                />
              </span>
            </span>
          )}
        </button>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-border px-3.5 text-xs text-charcoal transition hover:border-sepia/60 hover:bg-beige/10 disabled:opacity-60"
          >
            {value ? <RefreshCw className="h-3.5 w-3.5" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {busy ? "Uploading…" : value ? "Replace" : "Upload"}
          </button>
          {value && onRemove && (
            <button
              type="button"
              onClick={() => void onRemove()}
              disabled={busy}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-xs text-muted-foreground transition hover:text-destructive disabled:opacity-60"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
        className="hidden"
        onChange={(e) => void take(e.target.files?.[0])}
      />
    </div>
  );
}
