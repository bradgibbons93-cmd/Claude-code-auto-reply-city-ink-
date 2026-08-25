import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Check, Loader2, X } from "lucide-react";
import { StampBadge } from "@/components/Logo";

/**
 * What the artists see when they scan the QR code on the wall.
 *
 * Deliberately not part of the dashboard: no sidebar, no login, no stats, one
 * button. An artist does this once, tired, on their phone, between clients —
 * every extra step is a reason it doesn't happen, and a photo not taken is
 * gone for good.
 *
 * It posts straight to /api/uploads rather than going through tRPC, so a
 * phone on studio wifi doesn't need the whole app to boot to send a photo.
 */

interface Picked {
  file: File;
  preview: string;
}

export default function Upload() {
  const [artistName, setArtistName] = useState(() => {
    try {
      return localStorage.getItem("cityink.artist") ?? "";
    } catch {
      return "";
    }
  });
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = Array.from(list)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, 20)
      .map((file) => ({ file, preview: URL.createObjectURL(file) }));
    setPicked((current) => [...current, ...next].slice(0, 20));
    setError(null);
  }

  function remove(index: number) {
    setPicked((current) => {
      URL.revokeObjectURL(current[index].preview);
      return current.filter((_, i) => i !== index);
    });
  }

  const readAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Couldn't read that photo"));
      reader.readAsDataURL(file);
    });

  async function send() {
    if (!picked.length) {
      setError("Pick a photo first.");
      return;
    }
    setState("sending");
    setError(null);
    try {
      // The name is remembered on the phone so it only gets typed once ever.
      try {
        localStorage.setItem("cityink.artist", artistName);
      } catch {
        /* private browsing — not worth failing an upload over */
      }

      const photos = await Promise.all(
        picked.map(async (p) => ({
          contentType: p.file.type,
          dataUrl: await readAsDataUrl(p.file),
        }))
      );

      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artistName, note, photos }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || "That didn't send.");

      setSentCount(result.saved ?? photos.length);
      picked.forEach((p) => URL.revokeObjectURL(p.preview));
      setPicked([]);
      setNote("");
      setState("done");
    } catch (sendError) {
      setError((sendError as Error).message);
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15">
          <Check className="h-8 w-8 text-success" />
        </div>
        <h1 className="font-display text-2xl text-charcoal">
          {sentCount} photo{sentCount === 1 ? "" : "s"} sent
        </h1>
        <p className="text-sm text-muted-foreground">
          Nice one{artistName ? `, ${artistName.split(" ")[0]}` : ""} — they're in the studio's
          gallery.
        </p>
        <Button variant="outline" onClick={() => setState("idle")}>
          Send more
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md px-5 py-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <StampBadge className="h-16 w-16" />
        <h1 className="mt-3 font-display text-2xl text-charcoal">Upload your tattoos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          End of the day, snap what you've done and send it through. It goes straight to the
          studio for posting.
        </p>
      </div>

      <div className="space-y-4">
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-10 text-muted-foreground transition-colors hover:border-sepia hover:text-charcoal"
        >
          <Camera className="h-7 w-7" />
          <span className="text-sm font-medium">
            {picked.length ? "Add more photos" : "Choose photos"}
          </span>
        </button>

        {!!picked.length && (
          <div className="grid grid-cols-3 gap-2">
            {picked.map((p, index) => (
              <div key={p.preview} className="relative">
                <img
                  src={p.preview}
                  alt=""
                  className="aspect-square w-full rounded-lg border border-border object-cover"
                />
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label="Remove this photo"
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-charcoal text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <Input
          placeholder="Your name"
          value={artistName}
          onChange={(e) => setArtistName(e.target.value)}
        />
        <Textarea
          placeholder="Anything worth saying about it? (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-16"
        />

        {error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <Button className="w-full py-6 text-base" onClick={send} disabled={state === "sending"}>
          {state === "sending" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Sending{picked.length > 1 ? ` ${picked.length} photos` : ""}…
            </>
          ) : (
            `Send ${picked.length || ""} photo${picked.length === 1 ? "" : "s"}`.replace("  ", " ")
          )}
        </Button>
      </div>
    </div>
  );
}
