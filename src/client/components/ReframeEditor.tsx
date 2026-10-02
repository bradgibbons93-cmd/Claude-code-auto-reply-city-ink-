import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type Format = "square" | "story";
type Spot = { x: number; y: number };
type Framing = Spot & { fill: boolean; set: boolean };
export type PostFraming = Partial<Record<Format, Framing>>;

const FRAME: Record<Format, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: "Square post" },
  story: { w: 1080, h: 1920, label: "Story" },
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** `scheduled_posts.framing` as the server wrote it (autopost.ts PostFraming). */
export function parseFraming(raw: string | null | undefined): PostFraming {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<Framing>>;
    const out: PostFraming = {};
    for (const format of ["square", "story"] as const) {
      const f = parsed?.[format];
      if (f && typeof f.x === "number" && typeof f.y === "number") {
        out[format] = { x: clamp01(f.x), y: clamp01(f.y), fill: f.fill !== false, set: f.set === true };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * brandPhoto's rule for whether a photo fills the frame or is shown whole.
 * Only used for a post drawn before the server started recording it — the
 * server redraws those within minutes, and then `framing.fill` is the answer.
 */
function fillsFrame(format: Format, w: number, h: number) {
  const aspect = w / h;
  const frame = FRAME[format].w / FRAME[format].h;
  return format === "square" ? aspect >= 0.75 && aspect <= 1.34 : Math.abs(aspect - frame) / frame <= 0.12;
}

/**
 * Brad, 2 October: "I want to be able to drag to recenter the picture."
 *
 * The ORIGINAL upload is shown in the post's frame and moved with CSS
 * object-position, which is the same rule the server uses to draw the post
 * (autopost.ts brandPhoto), so where it is dropped here is where it lands in
 * the JPEG. The logo is laid over the top, drawn by the server where the saved
 * look puts it, so a tattoo can be kept clear of it. Saving sends the spot and
 * the server redraws both pictures from the original.
 *
 * `touch-none` on the frame is what makes this work on a phone: without it the
 * first finger movement scrolls the page and the drag never starts.
 */
export default function ReframeEditor({
  postId,
  uploadId,
  framing,
  onDone,
  onCancel,
}: {
  postId: number;
  uploadId: string;
  framing: PostFraming;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [format, setFormat] = useState<Format>("square");
  const [spot, setSpot] = useState<Record<Format, Spot>>(() => ({
    square: { x: framing.square?.x ?? 0.5, y: framing.square?.y ?? 0.5 },
    story: { x: framing.story?.x ?? 0.5, y: framing.story?.y ?? 0.5 },
  }));
  const [moved, setMoved] = useState<Record<Format, boolean>>({ square: false, story: false });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; px: number; py: number; start: Spot; slack: Spot } | null>(null);

  // On a phone the story frame runs down under the bottom menu: a drag
  // started there lands on the menu and scrolls the page, and Save ends up
  // hidden behind it. So the whole editor — tabs, frame, Save — is brought
  // into view when it opens and whenever the tab changes; the scroll margins
  // keep it clear of the header and the menu, and the frame is sized so it
  // all fits between them on a phone.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [format]);

  const photo = `/api/uploads/${uploadId}`;
  const fill = framing[format]?.fill ?? (natural ? fillsFrame(format, natural.w, natural.h) : true);

  // Which way the photo can go: a filled frame crops along its long side, a
  // whole photo has room along its short side. Neither, if the shapes match.
  const frameAspect = FRAME[format].w / FRAME[format].h;
  const photoAspect = natural ? natural.w / natural.h : frameAspect;
  const wider = photoAspect > frameAspect * 1.01;
  const taller = photoAspect < frameAspect * 0.99;
  const canX = fill ? wider : taller;
  const canY = fill ? taller : wider;
  const hint = !natural
    ? "Loading the photo…"
    : canX && canY
      ? "Drag the photo to move it."
      : canX
        ? "Drag left or right to move the photo."
        : canY
          ? "Drag up or down to move the photo."
          : "This photo is exactly the frame's shape, so there's nothing to move.";

  /**
   * The room the photo has to move in, in screen pixels: the frame's size
   * minus the photo's drawn size. Negative when the photo overflows (filled),
   * positive when it sits inside (whole). object-position puts the photo at
   * spot × slack, so a drag of d pixels is d / slack of the way.
   */
  const slack = (): Spot => {
    const el = box.current;
    if (!el || !natural) return { x: 0, y: 0 };
    const bw = el.clientWidth;
    const bh = el.clientHeight;
    const scale = fill ? Math.max(bw / natural.w, bh / natural.h) : Math.min(bw / natural.w, bh / natural.h);
    return { x: bw - natural.w * scale, y: bh - natural.h * scale };
  };

  const moveBy = (from: Spot, room: Spot, dx: number, dy: number) => {
    const next = {
      x: Math.abs(room.x) > 1 ? clamp01(from.x + dx / room.x) : from.x,
      y: Math.abs(room.y) > 1 ? clamp01(from.y + dy / room.y) : from.y,
    };
    setSpot((all) => ({ ...all, [format]: next }));
    if (next.x !== spot[format].x || next.y !== spot[format].y) setMoved((all) => ({ ...all, [format]: true }));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!natural || (!canX && !canY)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { id: e.pointerId, px: e.clientX, py: e.clientY, start: spot[format], slack: slack() };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    moveBy(d.start, d.slack, e.clientX - d.px, e.clientY - d.py);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 12;
    const keys: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const by = keys[e.key];
    if (!by) return;
    e.preventDefault();
    moveBy(spot[format], slack(), by[0], by[1]);
  };

  const reframe = trpc.posts.reframe.useMutation({
    onError: (error) => toast.error(error.message || "Couldn't move the photo."),
  });

  const save = () =>
    reframe.mutate(
      {
        id: postId,
        square: moved.square ? spot.square : undefined,
        story: moved.story ? spot.story : undefined,
      },
      {
        onSuccess: () => {
          toast.success(moved.square && moved.story ? "Both photos moved." : "Photo moved.");
          onDone();
        },
      }
    );

  const automatic = () =>
    reframe.mutate(
      { id: postId, [format]: null },
      {
        onSuccess: () => {
          toast.success(`${FRAME[format].label} is back to automatic.`);
          onDone();
        },
      }
    );

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
  const anyMoved = moved.square || moved.story;

  return (
    <div ref={root} className="scroll-mb-28 scroll-mt-24 space-y-3" data-testid="reframe-editor">
      <div role="tablist" aria-label="Which picture" className="grid grid-cols-2 gap-2">
        {(["square", "story"] as const).map((f) => (
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
            {moved[f] ? " · moved" : ""}
          </button>
        ))}
      </div>

      <div
        className="mx-auto"
        style={{ width: format === "story" ? "min(100%, calc(52vh * 9 / 16))" : "min(100%, 52vh)" }}
      >
        <div
          ref={box}
          data-testid="reframe-box"
          tabIndex={0}
          role="application"
          aria-label={`${FRAME[format].label}: drag the photo, or use the arrow keys, to move it`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className={cn(
            "relative touch-none select-none overflow-hidden rounded-xl bg-black outline-none focus-visible:ring-2 focus-visible:ring-sepia",
            format === "story" ? "aspect-[9/16]" : "aspect-square",
            canX || canY ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default"
          )}
        >
          {!fill && (
            // The soft backdrop a whole photo sits on, as the server draws it.
            <img
              src={photo}
              alt=""
              aria-hidden
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover blur-xl brightness-50"
            />
          )}
          <img
            key={photo}
            src={photo}
            alt="The artist's photo, being moved in the frame"
            draggable={false}
            data-testid="reframe-photo"
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className={cn("pointer-events-none absolute inset-0 h-full w-full", fill ? "object-cover" : "object-contain")}
            style={{ objectPosition: `${pct(spot[format].x)} ${pct(spot[format].y)}` }}
          />
          <img
            key={format}
            src={`/api/post-look/overlay?format=${format}`}
            alt=""
            aria-hidden
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
          {dragging && (
            // Thirds, while dragging, to line the tattoo up by.
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
              <div className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
              <div className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
              <div className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-sm text-muted-foreground" data-testid="reframe-hint">
        {hint} The logo stays put.
      </p>

      <div className="flex flex-wrap justify-center gap-2">
        <Button className="min-h-[44px]" disabled={!anyMoved || reframe.isPending} onClick={save}>
          {reframe.isPending ? "Saving…" : "Save position"}
        </Button>
        {framing[format]?.set && (
          <Button variant="outline" className="min-h-[44px]" disabled={reframe.isPending} onClick={automatic}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Back to automatic
          </Button>
        )}
        <Button variant="ghost" className="min-h-[44px]" disabled={reframe.isPending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
