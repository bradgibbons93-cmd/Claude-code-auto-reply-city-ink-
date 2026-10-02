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

  const enabled = data?.enabled ?? true;
  const preview = look
    ? `/api/post-look/preview?corner=${look.corner}&size=${look.size}&retouch=${look.retouch}`
    : undefined;

  return (
    <Card className="border-border" data-testid="autopost-card">
      <CardHeader>
        <CardTitle className="font-display text-xl text-charcoal">Photos into posts</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Every photo sent to the upload link gets the studio's logo, a colour touch-up and a
          caption, then waits in Posts for your OK. Nothing goes out until you approve it.
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

        {data && !data.hasLogo && (
          <p className="rounded-xl border border-sepia/40 bg-sepia/10 p-3 text-sm text-charcoal">
            There's no studio logo yet, so posts get the colour touch-up only.{" "}
            <Link href="/settings" className="text-sepia underline-offset-2 hover:underline">
              Add your logo in Settings
            </Link>{" "}
            and it goes on every one.
          </p>
        )}

        {data && data.waiting > 0 && (
          <Link
            href="/posts"
            className="block rounded-xl border border-sepia/50 p-3 text-sm font-medium text-charcoal hover:bg-beige/20"
          >
            {data.waiting} {data.waiting === 1 ? "post is" : "posts are"} waiting for your OK →
          </Link>
        )}

        <div className="grid gap-5 sm:grid-cols-[minmax(0,320px)_1fr]">
          <div className="overflow-hidden rounded-xl border border-border bg-elevated">
            {preview ? (
              <img
                key={preview}
                src={preview}
                alt="How a post will look: your latest photo with the logo on"
                className="max-h-[420px] w-full object-contain"
              />
            ) : (
              <div className="grid h-60 place-items-center text-sm text-muted-foreground">Loading…</div>
            )}
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
