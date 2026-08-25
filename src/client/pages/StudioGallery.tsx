import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, Copy, Printer, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Everything the artists have sent in, and the QR code that gets it there.
 *
 * "Used" doesn't delete anything — it just moves a photo out of the way once
 * it's been posted, so what's left is genuinely still to use. A month later
 * the studio still wants the whole back catalogue.
 */
export default function StudioGallery() {
  const utils = trpc.useUtils();
  const [unusedOnly, setUnusedOnly] = useState(false);

  const { data: uploads, isLoading } = trpc.uploads.list.useQuery(
    { unusedOnly },
    { refetchInterval: 30000 }
  );

  const markUsed = trpc.uploads.markUsed.useMutation({
    onSuccess: () => utils.uploads.list.invalidate(),
    onError: () => toast.error("Couldn't update that one."),
  });

  const remove = trpc.uploads.remove.useMutation({
    onSuccess: () => {
      toast("Deleted");
      utils.uploads.list.invalidate();
    },
    onError: () => toast.error("Couldn't delete that one."),
  });

  const uploadUrl =
    typeof window === "undefined" ? "/upload" : `${window.location.origin}/upload`;

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-display text-xl text-charcoal">
            The artists' upload link
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Print this and stick it up in the studio. An artist points a phone at it, picks the
            day's photos, types their name — no login, no app, nothing to set up.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <img
            src="/api/upload-qr.png"
            alt="QR code linking to the artist upload page"
            className="h-40 w-40 shrink-0 rounded-xl border border-border bg-white p-2"
          />
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Or send them the link
              </p>
              <p className="mt-1 break-all font-mono text-sm text-charcoal">{uploadUrl}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(uploadUrl)
                    .then(() => toast.success("Link copied"))
                    .catch(() => toast.error("Couldn't copy — select it by hand."));
                }}
              >
                <Copy className="mr-2 h-3.5 w-3.5" />
                Copy link
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-2 h-3.5 w-3.5" />
                Print the code
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="font-display text-xl text-charcoal">Studio gallery</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {uploads?.length
                ? `${uploads.length} photo${uploads.length === 1 ? "" : "s"} from the artists.`
                : "Nothing sent in yet."}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setUnusedOnly((v) => !v)}>
            {unusedOnly ? "Show everything" : "Only what's unused"}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-sm text-muted-foreground">Loading…</p>
          ) : !uploads?.length ? (
            <p className="py-8 text-sm text-muted-foreground">
              Once an artist scans the code above, their photos land here.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {uploads.map((upload) => (
                <figure
                  key={upload.id}
                  className={`group relative overflow-hidden rounded-xl border border-border ${
                    upload.usedAt ? "opacity-55" : ""
                  }`}
                >
                  <a href={upload.url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={upload.url}
                      alt={upload.note || `Tattoo by ${upload.artistName || "an artist"}`}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                  </a>

                  <figcaption className="space-y-0.5 p-2">
                    <p className="truncate text-xs text-charcoal">
                      {upload.artistName || "Unnamed artist"}
                    </p>
                    {upload.note && (
                      <p className="line-clamp-2 text-[0.7rem] text-muted-foreground">
                        {upload.note}
                      </p>
                    )}
                    {upload.usedAt && (
                      <p className="text-[0.65rem] uppercase tracking-[0.14em] text-sepia">
                        Used
                      </p>
                    )}
                  </figcaption>

                  <div className="flex gap-1 border-t border-border p-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 flex-1 px-1 text-[0.7rem]"
                      onClick={() =>
                        markUsed.mutate({ id: upload.id, used: !upload.usedAt })
                      }
                    >
                      {upload.usedAt ? (
                        <>
                          <Undo2 className="mr-1 h-3 w-3" />
                          Unmark
                        </>
                      ) : (
                        <>
                          <Check className="mr-1 h-3 w-3" />
                          Used it
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Delete this photo"
                      className="h-7 px-2 text-destructive"
                      onClick={() => remove.mutate({ id: upload.id })}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </figure>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
