import { useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CalendarRange, Camera, Check, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { addDays, format } from "date-fns";

/**
 * A batch of photos, one a day.
 *
 * The studio's week already exists as pictures — the artists send their work
 * in every night. What was missing was any way to turn eleven of them into
 * eleven posts without opening the composer eleven times and typing eleven
 * dates. Pick the lot, say when to start, done.
 *
 * The order of the grid is the order they go out, and it's shown as dates
 * before anything is saved, because "eleven posts scheduled" is not
 * something anyone can check.
 */

interface Picked {
  imageUrl: string;
  uploadId?: string;
  caption?: string;
  label?: string;
}

/** Tomorrow, as the default start — today at 11am has usually already gone. */
function defaultStart(): string {
  return format(addDays(new Date(), 1), "yyyy-MM-dd");
}

export default function BulkScheduler({ onScheduled }: { onScheduled: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [startDate, setStartDate] = useState(defaultStart);
  const [timeOfDay, setTimeOfDay] = useState("11:00");
  const [spacingDays, setSpacingDays] = useState(1);
  const [sharedCaption, setSharedCaption] = useState("");
  const [writeCaptions, setWriteCaptions] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: gallery } = trpc.uploads.list.useQuery({ unusedOnly: false }, { enabled: isOpen });

  const bulk = trpc.posts.bulkSchedule.useMutation({
    onSuccess: (result) => {
      toast.success(
        `${result.scheduled.length} post${result.scheduled.length === 1 ? "" : "s"} queued — one a day from ${format(
          new Date(result.scheduled[0].scheduledAt),
          "d MMM"
        )}.`
      );
      setPicked([]);
      setSharedCaption("");
      setIsOpen(false);
      onScheduled();
    },
    onError: (error) => toast.error(error.message || "Couldn't queue those."),
  });

  const isPicked = (url: string) => picked.some((p) => p.imageUrl === url);

  function toggle(item: Picked) {
    setPicked((current) =>
      current.some((p) => p.imageUrl === item.imageUrl)
        ? current.filter((p) => p.imageUrl !== item.imageUrl)
        : [...current, item]
    );
  }

  /** Straight off the phone — several at once, which is the whole point. */
  async function uploadFiles(files: FileList) {
    setUploading(true);
    const added: Picked[] = [];
    try {
      for (const file of Array.from(files).slice(0, 40)) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Couldn't read that photo"));
          reader.readAsDataURL(file);
        });
        const response = await fetch("/api/post-image", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ contentType: file.type, dataUrl }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error || "That didn't upload.");
        added.push({ imageUrl: result.url, label: file.name });
      }
      setPicked((current) => [...current, ...added]);
      toast.success(`${added.length} photo${added.length === 1 ? "" : "s"} added`);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  /**
   * The plan, before anything is saved.
   *
   * This mirrors the server's spacing rather than asking it: the server steps
   * over days that already have a post, which this can't know, so the dates
   * here are the shape of the run and the toast afterwards is the truth.
   */
  const plan = useMemo(() => {
    if (!picked.length || !startDate) return [];
    const [hours, minutes] = timeOfDay.split(":").map(Number);
    const first = new Date(`${startDate}T00:00:00`);
    first.setHours(hours || 11, minutes || 0, 0, 0);
    return picked.map((photo, index) => ({
      photo,
      at: addDays(first, index * Math.max(1, spacingDays)),
    }));
  }, [picked, startDate, timeOfDay, spacingDays]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger>
        <Button variant="outline">
          <CalendarRange className="mr-2 h-4 w-4" />
          Schedule a batch
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto border-border bg-card">
        <DialogHeader>
          <DialogTitle className="text-charcoal">A batch of photos, one a day</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Tap the photos you want. They go out in the order you pick them.
              </p>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void uploadFiles(e.target.files);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <Camera className="mr-2 h-3.5 w-3.5" />
                    Add from phone
                  </>
                )}
              </Button>
            </div>

            <div className="mt-3 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto rounded-xl border border-border bg-surface p-2 sm:grid-cols-5">
              {picked
                .filter((p) => !p.uploadId)
                .map((photo) => (
                  <button
                    key={photo.imageUrl}
                    type="button"
                    onClick={() => toggle(photo)}
                    className="relative overflow-hidden rounded-lg border-2 border-sepia"
                  >
                    <img
                      src={photo.imageUrl}
                      alt={photo.label || "Photo to post"}
                      className="aspect-square w-full object-cover"
                    />
                    <span className="absolute right-1 top-1 rounded-full bg-charcoal/80 p-0.5 text-white">
                      <X className="h-3 w-3" />
                    </span>
                  </button>
                ))}

              {gallery?.length ? (
                gallery.map((upload) => {
                  const selected = isPicked(upload.url);
                  const order = picked.findIndex((p) => p.imageUrl === upload.url);
                  return (
                    <button
                      key={upload.id}
                      type="button"
                      onClick={() =>
                        toggle({
                          imageUrl: upload.url,
                          uploadId: upload.id,
                          label: upload.artistName ?? undefined,
                        })
                      }
                      title={upload.note ?? undefined}
                      className={`relative overflow-hidden rounded-lg border-2 transition ${
                        selected ? "border-sepia" : "border-transparent hover:border-border"
                      } ${upload.usedAt && !selected ? "opacity-40" : ""}`}
                    >
                      <img
                        src={upload.url}
                        alt={upload.note || "Studio photo"}
                        className="aspect-square w-full object-cover"
                        loading="lazy"
                      />
                      {selected && (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-sepia text-[0.65rem] font-semibold text-white">
                          {order + 1}
                        </span>
                      )}
                    </button>
                  );
                })
              ) : (
                <p className="col-span-full p-3 text-xs text-muted-foreground">
                  Nothing in the gallery yet — the artists' uploads land here. Or add photos from
                  your phone.
                </p>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Faded ones have already been used for a post. You can still pick them.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-sm">First one on</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-2 border-border"
              />
            </div>
            <div>
              <label className="text-sm">At</label>
              <Input
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                className="mt-2 border-border"
              />
            </div>
            <div>
              <label className="text-sm">A post every</label>
              <select
                value={spacingDays}
                onChange={(e) => setSpacingDays(Number(e.target.value))}
                className="mt-2 h-10 w-full rounded-md border border-border px-3 text-sm"
              >
                <option value={1}>day</option>
                <option value={2}>2 days</option>
                <option value={3}>3 days</option>
                <option value={7}>week</option>
              </select>
            </div>
          </div>

          <div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={writeCaptions}
                onChange={(e) => setWriteCaptions(e.target.checked)}
                className="h-4 w-4"
              />
              <Sparkles className="h-3.5 w-3.5 text-sepia" />
              Write each caption with AI
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              It can't see the photos, so it writes from the artist's note and what's in Training.
              Every one is editable before it goes out.
            </p>
            <Textarea
              placeholder={
                writeCaptions
                  ? "Anything the captions should all mention (optional)"
                  : "The caption for all of them"
              }
              value={sharedCaption}
              onChange={(e) => setSharedCaption(e.target.value)}
              className="mt-3 min-h-20 border-border"
            />
          </div>

          {plan.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="text-[0.6rem] uppercase tracking-[0.18em] text-sepia">The run</p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-sm">
                {plan.map(({ photo, at }, index) => (
                  <li key={photo.imageUrl} className="flex items-center gap-2">
                    <img
                      src={photo.imageUrl}
                      alt=""
                      className="h-7 w-7 rounded object-cover"
                      loading="lazy"
                    />
                    <span className="text-muted-foreground">{index + 1}.</span>
                    <span className="text-charcoal">{format(at, "EEE d MMM, HH:mm")}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                A day that already has a post queued gets stepped over, so the real dates can run
                on further than this.
              </p>
            </div>
          )}

          <Button
            className="w-full"
            disabled={!picked.length || bulk.isPending}
            onClick={() =>
              bulk.mutate({
                photos: picked.map((p) => ({
                  imageUrl: p.imageUrl,
                  uploadId: p.uploadId,
                  caption: p.caption,
                })),
                startDate: new Date(`${startDate}T${timeOfDay}:00`),
                timeOfDay,
                spacingDays,
                sharedCaption: sharedCaption || undefined,
                writeCaptions,
                avoidClashes: true,
              })
            }
          >
            {bulk.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Queueing {picked.length}…
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Queue {picked.length || "these"} post{picked.length === 1 ? "" : "s"}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
