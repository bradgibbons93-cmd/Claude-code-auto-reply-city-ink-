import { useEffect, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Corner = "bottom-right" | "bottom-left" | "bottom-centre" | "top-right" | "top-left";
type Size = "small" | "medium" | "large";
type Retouch = "off" | "light" | "punchy";
type Look = { corner: Corner; size: Size; retouch: Retouch };

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
const RETOUCHES: Array<[Retouch, string]> = [
  ["off", "None"],
  ["light", "Light"],
  ["punchy", "Punchy"],
];

function Choice<T extends string>({
  label,
  options,
  value,
  onPick,
  disabled,
}: {
  label: string;
  options: Array<[T, string]>;
  value: T | undefined;
  onPick: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <div role="radiogroup" aria-label={label} className="mt-2 flex flex-wrap gap-2">
        {options.map(([id, text]) => {
          const on = value === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onPick(id)}
              className={cn(
                "min-h-[40px] rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-50",
                on ? "border-sepia bg-sepia/15 text-charcoal" : "border-border text-muted-foreground hover:border-sepia/60"
              )}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Artist uploads → posts (server/autopost.ts). The switch, the look of the
 * logo template, and when they go out — with the template drawn on the
 * studio's latest photo, so the corner is picked by looking at it.
 */
export default function AutoPostCard() {
  const utils = trpc.useUtils();
  const { data } = trpc.autopost.get.useQuery(undefined, { refetchInterval: 30000 });
  const [look, setLook] = useState<Look | null>(null);
  const [time, setTime] = useState("");

  useEffect(() => {
    if (data && !look) setLook(data.look as Look);
    if (data && !time) setTime(data.time);
  }, [data, look, time]);

  const save = trpc.autopost.save.useMutation({
    onSuccess: () => utils.autopost.get.invalidate(),
    onError: () => {
      toast.error("Couldn't save that.");
      if (data) setLook(data.look as Look);
    },
  });

  const choose = (patch: Partial<Look>) => {
    if (!look) return;
    setLook({ ...look, ...patch });
    save.mutate({ look: patch });
  };

  const [uploading, setUploading] = useState(false);
  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/brand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "postlogo", dataUrl }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error || "Couldn't upload that logo.");
      await save.mutateAsync({ logoAssetId: body.id });
      toast.success("Logo saved. It goes on every new post.");
    } catch (error) {
      toast.error((error as Error).message || "Couldn't upload that logo.");
    } finally {
      setUploading(false);
    }
  };

  const enabled = data?.enabled ?? true;
  // The logo's address is part of the key, so a new logo redraws the previews.
  const previewFor = (format: "square" | "story") =>
    look
      ? `/api/post-look/preview?format=${format}&corner=${look.corner}&size=${look.size}&retouch=${look.retouch}&logo=${encodeURIComponent(data?.logoUrl ?? "")}`
      : undefined;
  const square = previewFor("square");
  const story = previewFor("story");

  return (
    <Card className="border-border" data-testid="autopost-card">
      <CardHeader>
        <CardTitle className="font-display text-xl text-charcoal">Photos into posts</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Every photo sent to the upload link gets the logo, a colour touch-up and a caption, as a
          square post and an Instagram story, then waits in Posts for your OK. Nothing goes out
          until you approve it.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <Choice
          label="Turn new photos into posts"
          options={[
            ["on", "On"],
            ["off", "Off"],
          ]}
          value={enabled ? "on" : "off"}
          onPick={(v) => save.mutate({ enabled: v === "on" })}
          disabled={!data || save.isPending}
        />

        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Logo on posts</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {/* Always on dark: the logo that suits a photo is usually white. */}
            <div className="grid h-16 w-40 place-items-center rounded-xl border border-border bg-[#141414] p-2">
              {data?.logoUrl ? (
                <img src={data.logoUrl} alt="The logo that goes on posts" className="max-h-full max-w-full object-contain" />
              ) : (
                <span className="text-xs text-white/70">No logo yet</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="inline-flex min-h-[40px] cursor-pointer items-center rounded-xl border border-border px-3 text-sm font-medium text-charcoal hover:border-sepia">
                {uploading ? "Uploading…" : data?.customLogo ? "Change logo" : "Upload a logo for posts"}
                <input
                  type="file"
                  accept="image/png,image/webp,image/jpeg"
                  className="sr-only"
                  disabled={uploading}
                  onChange={(e) => {
                    void uploadLogo(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {data?.customLogo && (
                <button
                  type="button"
                  onClick={() => save.mutate({ logoAssetId: null })}
                  className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Use the studio logo instead
                </button>
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            A PNG with a see-through background looks best. It's only used on posts, not in the app.
          </p>
        </div>

        {data && data.waiting > 0 && (
          <Link
            href="/posts"
            className="block rounded-xl border border-sepia/50 p-3 text-sm font-medium text-charcoal hover:bg-beige/20"
          >
            {data.waiting} {data.waiting === 1 ? "post is" : "posts are"} waiting for your OK →
          </Link>
        )}

        <div className="grid gap-5 sm:grid-cols-[minmax(0,340px)_1fr]">
          <div className="grid grid-cols-[1fr_0.75fr] items-start gap-3">
            <figure className="m-0">
              <div className="aspect-square overflow-hidden rounded-xl border border-border bg-elevated">
                {square ? (
                  <img key={square} src={square} alt="The square post: your latest photo with the logo on" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <figcaption className="mt-1 text-xs text-muted-foreground">Post · 1080 × 1080</figcaption>
            </figure>
            <figure className="m-0">
              <div className="aspect-[9/16] overflow-hidden rounded-xl border border-border bg-elevated">
                {story ? (
                  <img key={story} src={story} alt="The Instagram story version" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <figcaption className="mt-1 text-xs text-muted-foreground">Story · 1080 × 1920</figcaption>
            </figure>
          </div>
          <div className="space-y-4">
            <Choice label="Logo spot" options={CORNERS} value={look?.corner} onPick={(corner) => choose({ corner })} />
            <Choice label="Logo size" options={SIZES} value={look?.size} onPick={(size) => choose({ size })} />
            <Choice label="Colour touch-up" options={RETOUCHES} value={look?.retouch} onPick={(retouch) => choose({ retouch })} />
            <div>
              <label htmlFor="autopost-time" className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Posts go out at
              </label>
              <Input
                id="autopost-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                onBlur={() => {
                  if (time && time !== data?.time) save.mutate({ time });
                }}
                className="mt-2 max-w-[160px] border-border"
              />
              <p className="mt-1 text-xs text-muted-foreground">One a day, on the next free day.</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
