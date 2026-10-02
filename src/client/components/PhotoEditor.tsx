import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type Format = "square" | "portrait" | "story";
export type Spot = { x: number; y: number; zoom?: number };
export type Adjust = { brightness: number; contrast: number; saturation: number };
type Corner = "bottom-right" | "bottom-left" | "bottom-centre" | "top-right" | "top-left";
type Size = "small" | "medium" | "large";
type Shadow = "off" | "soft" | "strong";
export type LogoChoice = { on: boolean; corner: Corner; size: Size; shadow: Shadow };

/** What the editor hands back. Every spot has its zoom filled in. */
export type PhotoEdit = {
  format: Format;
  spots: Partial<Record<Format, Required<Spot>>>;
  /** Which pictures were moved or zoomed, so untouched ones stay automatic. */
  touched: Partial<Record<Format, boolean>>;
  adjust: Adjust;
  logo: LogoChoice;
  /** Colour or logo changed from where the editor started. */
  styleTouched: boolean;
};

export type EditorStart = {
  format?: Format;
  /** Where each picture is now. `fill` stands in for a zoom the server didn't record. */
  spots?: Partial<Record<Format, Spot & { fill?: boolean }>>;
  adjust?: Adjust;
  logo?: LogoChoice;
};

const FRAME: Record<Format, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: "Square" },
  portrait: { w: 1080, h: 1350, label: "Portrait" },
  story: { w: 1080, h: 1920, label: "Story" },
};
const CORNERS: Array<[Corner, string]> = [
  ["bottom-right", "Bottom right"],
  ["bottom-left", "Bottom left"],
  ["bottom-centre", "Bottom middle"],
  ["top-right", "Top right"],
  ["top-left", "Top left"],
];
const SIZES: Array<[Size, string]> = [
  ["small", "Small"],
  ["medium", "Medium"],
  ["large", "Large"],
];
const SHADOWS: Array<[Shadow, string]> = [
  ["off", "None"],
  ["soft", "Soft"],
  ["strong", "Strong"],
];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** brandPhoto's rule (server/autopost.ts) for when a photo fills a frame by itself. */
function nearShape(format: Format, w: number, h: number) {
  const aspect = w / h;
  const frame = FRAME[format].w / FRAME[format].h;
  return format === "square" ? aspect >= 0.75 && aspect <= 1.34 : Math.abs(aspect - frame) / frame <= 0.12;
}

function Chips<T extends string>({
  label,
  options,
  value,
  onPick,
  disabled,
}: {
  label: string;
  options: Array<[T, string]>;
  value: T;
  onPick: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <div role="radiogroup" aria-label={label} className="mt-2 flex flex-wrap gap-2">
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            disabled={disabled}
            onClick={() => onPick(id)}
            className={cn(
              "min-h-[44px] rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-40",
              value === id ? "border-sepia bg-sepia/15 text-charcoal" : "border-border text-muted-foreground hover:border-sepia/60"
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  shown,
  onChange,
  children,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  shown: string;
  onChange: (v: number) => void;
  children?: ReactNode;
}) {
  const id = `slider-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </label>
        <span className="text-sm tabular-nums text-charcoal">{shown}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-11 w-full cursor-pointer accent-sepia"
      />
      {children}
    </div>
  );
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n)}`;

/**
 * Brad, 2 October, on the photo in Schedule a post: "a little pop up tab or
 * text either under or on the photo as a button ... edit or add logo and post
 * then it will come up on that picture and can adjust the saturation contrast
 * and brightness and adjust the position and be able to crop and zoom".
 *
 * One editor, two doors: the photo on a post being written by hand, and a post
 * the artists' uploads made that's waiting for the OK.
 *
 * What's on screen is the ORIGINAL photo, laid out with exactly the numbers
 * the server will draw it with (server/autopost.ts brandPhoto): size as a
 * multiple of "the whole photo just fits", position as CSS object-position. So
 * the crop, zoom and colour seen here are what the JPEG comes out as; the
 * colour is a CSS filter in the same order the server applies it. The logo is
 * the server's own drawing of it, laid over the top, so it can be kept off the
 * tattoo.
 *
 * Full screen, rendered into <body> like PhotoViewer and for the same reason:
 * opened from inside a card or the Schedule a post box, `fixed` would resolve
 * against a transformed ancestor and come out under the header and the bottom
 * menu. Four ways out, also like PhotoViewer — Cancel, the X, Escape and the
 * phone's back gesture — because this app runs from the home screen with no
 * browser back button.
 */
export default function PhotoEditor({
  title,
  source,
  formats,
  mode,
  start,
  saveLabel,
  onCancel,
  onSave,
  onAutomatic,
}: {
  title: string;
  /** The original photo — never an earlier edit of it. */
  source: string;
  formats: Format[];
  /** "pick": the tab chooses the post's shape. "each": every tab is its own picture. */
  mode: "pick" | "each";
  start?: EditorStart;
  saveLabel: string;
  onCancel: () => void;
  onSave: (edit: PhotoEdit) => Promise<void>;
  /** Waiting posts: put the photo back to the app's own crop and the studio's look. */
  onAutomatic?: () => Promise<void>;
}) {
  const { data: studio } = trpc.autopost.get.useQuery();
  const [format, setFormat] = useState<Format>(start?.format && formats.includes(start.format) ? start.format : formats[0]);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [spots, setSpots] = useState<Partial<Record<Format, Spot & { fill?: boolean }>>>(start?.spots ?? {});
  const [touched, setTouched] = useState<Partial<Record<Format, boolean>>>({});
  const [adjust, setAdjust] = useState<Adjust | null>(start?.adjust ?? null);
  const [logo, setLogo] = useState<LogoChoice | null>(start?.logo ?? null);
  const [styleTouched, setStyleTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gesturing, setGesturing] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // The studio's look is where a photo with no choices of its own starts.
  useEffect(() => {
    if (!studio) return;
    if (!adjust) setAdjust(studio.adjust as Adjust);
    if (!logo) {
      const look = studio.look as { corner: Corner; size: Size; shadow?: Shadow };
      setLogo({ on: studio.hasLogo, corner: look.corner, size: look.size, shadow: look.shadow ?? "soft" });
    }
  }, [studio, adjust, logo]);

  // Back gesture closes, Escape closes, the page behind doesn't scroll. The
  // history entry is pushed once on mount and only popped by us if back
  // didn't already pop it — PhotoViewer explains both halves of that.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    let poppedByBack = false;
    window.history.pushState({ photoEditor: true }, "");
    const pop = () => {
      poppedByBack = true;
      cancelRef.current();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current();
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("keydown", key);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("keydown", key);
      document.body.style.overflow = previous;
      if (!poppedByBack) window.history.back();
    };
  }, []);

  /* ---------- the geometry, in the server's terms ---------- */
  const frame = FRAME[format];
  const nw = natural?.w ?? frame.w;
  const nh = natural?.h ?? frame.h;
  const contain = Math.min(frame.w / nw, frame.h / nh);
  const coverZoom = Math.max(frame.w / nw, frame.h / nh) / contain;
  const maxZoom = coverZoom * 3;
  const spotFor = (f: Format): Required<Spot> => {
    const s = spots[f];
    const fr = FRAME[f];
    const c = Math.min(fr.w / nw, fr.h / nh);
    const cz = Math.max(fr.w / nw, fr.h / nh) / c;
    const auto = s?.fill ?? (natural ? nearShape(f, nw, nh) : true);
    return {
      x: clamp(s?.x ?? 0.5, 0, 1),
      y: clamp(s?.y ?? 0.5, 0, 1),
      zoom: clamp(s?.zoom ?? (auto ? cz : 1), 1, cz * 3),
    };
  };
  const spot = spotFor(format);
  const dwF = (nw * contain * spot.zoom) / frame.w; // photo width as a share of the frame
  const dhF = (nh * contain * spot.zoom) / frame.h;
  const covers = dwF >= 0.999 && dhF >= 0.999;
  const canX = Math.abs(1 - dwF) > 0.005;
  const canY = Math.abs(1 - dhF) > 0.005;

  const spotRef = useRef(spot);
  spotRef.current = spot;
  const place = (next: Partial<Spot>) => {
    setSpots((all) => ({ ...all, [format]: { ...spotRef.current, ...next } }));
    setTouched((all) => ({ ...all, [format]: true }));
  };

  /* ---------- drag to move, pinch to zoom ---------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "pan"; px: number; py: number; start: Required<Spot>; w: number; h: number }
    | { kind: "pinch"; dist: number; zoom: number }
    | null
  >(null);
  const beginPan = (px: number, py: number) => {
    const rect = box.current?.getBoundingClientRect();
    gesture.current = { kind: "pan", px, py, start: spotRef.current, w: rect?.width ?? 1, h: rect?.height ?? 1 };
  };
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!natural) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) beginPan(e.clientX, e.clientY);
    if (pointers.current.size === 2) gesture.current = { kind: "pinch", dist: spread(), zoom: spotRef.current.zoom };
    setGesturing(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      place({ zoom: round4(clamp((g.zoom * spread()) / g.dist, 1, maxZoom)) });
    } else if (g.kind === "pan" && pointers.current.size === 1) {
      // The photo's left edge sits at x × (1 − width share) of the frame, so a
      // drag of d frame-widths moves x by d / (1 − width share).
      const sx = (e.clientX - g.px) / g.w;
      const sy = (e.clientY - g.py) / g.h;
      const roomX = 1 - (nw * contain * g.start.zoom) / frame.w;
      const roomY = 1 - (nh * contain * g.start.zoom) / frame.h;
      place({
        x: Math.abs(roomX) > 0.005 ? round4(clamp(g.start.x + sx / roomX, 0, 1)) : g.start.x,
        y: Math.abs(roomY) > 0.005 ? round4(clamp(g.start.y + sy / roomY, 0, 1)) : g.start.y,
      });
    }
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      // Lifting one finger of a pinch carries on as a drag, from here.
      const [p] = [...pointers.current.values()];
      beginPan(p.x, p.y);
    } else if (pointers.current.size === 0) {
      gesture.current = null;
      setGesturing(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.03;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => canX && place({ x: clamp(spot.x - step * Math.sign(1 - dwF), 0, 1) }),
      ArrowRight: () => canX && place({ x: clamp(spot.x + step * Math.sign(1 - dwF), 0, 1) }),
      ArrowUp: () => canY && place({ y: clamp(spot.y - step * Math.sign(1 - dhF), 0, 1) }),
      ArrowDown: () => canY && place({ y: clamp(spot.y + step * Math.sign(1 - dhF), 0, 1) }),
      "+": () => place({ zoom: clamp(spot.zoom * 1.05, 1, maxZoom) }),
      "=": () => place({ zoom: clamp(spot.zoom * 1.05, 1, maxZoom) }),
      "-": () => place({ zoom: clamp(spot.zoom / 1.05, 1, maxZoom) }),
    };
    if (moves[e.key]) {
      e.preventDefault();
      moves[e.key]();
    }
  };

  const setColour = (patch: Partial<Adjust>) => {
    if (!adjust) return;
    setAdjust({ ...adjust, ...patch });
    setStyleTouched(true);
  };
  const setLogoChoice = (patch: Partial<LogoChoice>) => {
    if (!logo) return;
    setLogo({ ...logo, ...patch });
    setStyleTouched(true);
  };

  const ready = !!natural && !!adjust && !!logo;
  const save = async () => {
    if (!ready || !adjust || !logo) return;
    setSaving(true);
    try {
      const all: PhotoEdit["spots"] = {};
      for (const f of formats) all[f] = spotFor(f);
      await onSave({ format, spots: all, touched, adjust, logo, styleTouched });
    } catch {
      // The caller has said what went wrong; the edit stays open to try again.
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    if (onAutomatic) {
      setSaving(true);
      try {
        await onAutomatic();
      } catch {
        // as above
      } finally {
        setSaving(false);
      }
      return;
    }
    setSpots({});
    setTouched({});
    if (studio) {
      setAdjust(studio.adjust as Adjust);
      const look = studio.look as { corner: Corner; size: Size; shadow?: Shadow };
      setLogo({ on: studio.hasLogo, corner: look.corner, size: look.size, shadow: look.shadow ?? "soft" });
    }
    setStyleTouched(false);
  };

  const filter = adjust
    ? `brightness(${adjust.brightness}) saturate(${adjust.saturation}) contrast(${adjust.contrast})`
    : undefined;
  const overlay = logo
    ? `/api/post-look/overlay?format=${format}&logo=${logo.on ? "on" : "off"}&corner=${logo.corner}&size=${logo.size}&shadow=${logo.shadow}&v=${encodeURIComponent(studio?.logoUrl ?? "")}`
    : undefined;
  const pct = (n: number) => `${(n * 100).toFixed(3)}%`;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="photo-editor"
      className="fixed inset-0 z-[70] flex flex-col bg-background text-charcoal"
    >
      <header className="flex items-center gap-2 border-b border-border px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close without saving"
          className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-elevated"
        >
          <X className="h-5 w-5" />
        </button>
        <h2 className="min-w-0 flex-1 truncate font-display text-lg">{title}</h2>
      </header>

      {/* The photo stays put while the controls scroll under it: every slider
          and logo choice is made looking at the picture it changes. The first
          version scrolled the photo off the top the moment you reached the
          logo options, which is exactly when you need to see it. */}
      <div className="shrink-0 space-y-3 border-b border-border px-4 pb-3 pt-3">
        {formats.length > 1 && (
          <div role="tablist" aria-label="Shape" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${formats.length}, minmax(0, 1fr))` }}>
            {formats.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={format === f}
                onClick={() => setFormat(f)}
                className={cn(
                  "min-h-[44px] rounded-xl border text-sm font-medium transition-colors",
                  format === f ? "border-sepia bg-sepia/15 text-charcoal" : "border-border text-muted-foreground hover:border-sepia/60"
                )}
              >
                {FRAME[f].label}
                {mode === "each" && touched[f] ? " · moved" : ""}
              </button>
            ))}
          </div>
        )}

        <div className="mx-auto" style={{ width: `min(100%, calc(38dvh * ${frame.w} / ${frame.h}))` }}>
          <div
            ref={box}
            data-testid="editor-frame"
            tabIndex={0}
            role="application"
            aria-label="The photo in its frame. Drag to move it, pinch to zoom, or use the arrow keys and plus and minus."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onKeyDown={onKeyDown}
            className={cn(
              "relative touch-none select-none overflow-hidden rounded-xl bg-black outline-none focus-visible:ring-2 focus-visible:ring-sepia",
              gesturing ? "cursor-grabbing" : "cursor-grab"
            )}
            style={{ aspectRatio: `${frame.w} / ${frame.h}` }}
          >
            {natural && !covers && (
              // The soft backdrop the server draws wherever the photo doesn't reach.
              <img
                src={source}
                alt=""
                aria-hidden
                draggable={false}
                className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover"
                style={{ filter: `blur(24px) brightness(0.5) ${filter ?? ""}` }}
              />
            )}
            <img
              src={source}
              alt="Your photo"
              draggable={false}
              data-testid="editor-photo"
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className="pointer-events-none absolute max-w-none"
              style={
                natural
                  ? {
                      width: pct(dwF),
                      height: pct(dhF),
                      left: pct(spot.x * (1 - dwF)),
                      top: pct(spot.y * (1 - dhF)),
                      filter,
                    }
                  : { inset: 0, width: "100%", height: "100%", objectFit: "cover", filter }
              }
            />
            {overlay && studio?.hasLogo && (
              <img
                key={overlay}
                src={overlay}
                alt=""
                aria-hidden
                draggable={false}
                data-testid="editor-logo"
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            )}
            {gesturing && (
              <div aria-hidden className="pointer-events-none absolute inset-0">
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
        <p className="text-center text-sm text-muted-foreground" data-testid="editor-hint">
          {!natural
            ? "Loading the photo…"
            : canX || canY
              ? "Drag to move it. Pinch or use Zoom to crop in."
              : "Zoom in to crop it, then drag to move it."}
        </p>

        <section aria-label="Crop and colour" className="space-y-3">
          <Slider
            label="Zoom"
            value={spot.zoom}
            min={1}
            max={maxZoom}
            shown={covers ? `${Math.round((spot.zoom / coverZoom) * 100)}%` : "Whole photo"}
            onChange={(zoom) => place({ zoom: round4(zoom) })}
          >
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => place({ zoom: 1, x: 0.5, y: 0.5 })}
                className="min-h-[44px] rounded-xl border border-border px-3 text-sm text-muted-foreground hover:border-sepia/60"
              >
                Whole photo
              </button>
              <button
                type="button"
                onClick={() => place({ zoom: round4(coverZoom), x: 0.5, y: 0.5 })}
                className="min-h-[44px] rounded-xl border border-border px-3 text-sm text-muted-foreground hover:border-sepia/60"
              >
                Fill the frame
              </button>
            </div>
          </Slider>
          {adjust && (
            <>
              <Slider label="Brightness" value={adjust.brightness} min={0.5} max={1.5} shown={signed((adjust.brightness - 1) * 100)} onChange={(brightness) => setColour({ brightness })} />
              <Slider label="Contrast" value={adjust.contrast} min={0.5} max={1.5} shown={signed((adjust.contrast - 1) * 100)} onChange={(contrast) => setColour({ contrast })} />
              <Slider label="Saturation" value={adjust.saturation} min={0} max={2} shown={signed((adjust.saturation - 1) * 100)} onChange={(saturation) => setColour({ saturation })} />
            </>
          )}
        </section>

        {logo && (
          <section aria-label="Logo" className="space-y-4">
            {studio?.hasLogo ? (
              <>
                <Chips label="Logo" options={[["on", "On"], ["off", "Off"]] as Array<["on" | "off", string]>} value={logo.on ? "on" : "off"} onPick={(v) => setLogoChoice({ on: v === "on" })} />
                <Chips label="Logo spot" options={CORNERS} value={logo.corner} onPick={(corner) => setLogoChoice({ corner })} disabled={!logo.on} />
                <Chips label="Logo size" options={SIZES} value={logo.size} onPick={(size) => setLogoChoice({ size })} disabled={!logo.on} />
                <Chips label="Logo shadow" options={SHADOWS} value={logo.shadow} onPick={(shadow) => setLogoChoice({ shadow })} disabled={!logo.on} />
              </>
            ) : (
              <p className="rounded-xl border border-border p-3 text-sm text-muted-foreground">
                No logo yet. Add one in Gallery → Logo on posts and it goes on here.
              </p>
            )}
          </section>
        )}

        <button
          type="button"
          onClick={() => void reset()}
          disabled={saving}
          className="inline-flex min-h-[44px] items-center gap-2 text-sm text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          {onAutomatic ? "Back to automatic" : "Start again"}
        </button>
      </div>

      <footer className="flex gap-2 border-t border-border px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="ghost" className="min-h-[48px]" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button className="min-h-[48px] flex-1" onClick={() => void save()} disabled={!ready || saving}>
          {saving ? "Saving…" : saveLabel}
        </Button>
      </footer>
    </div>,
    document.body
  );
}
