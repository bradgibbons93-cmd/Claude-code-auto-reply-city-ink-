import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, Images, Link2, Loader2, X } from "lucide-react";
import { toast } from "sonner";

/**
 * Where a post's picture comes from.
 *
 * It used to be an "Image URL" box, which meant the photo had to already be
 * on the internet somewhere — and a picture just taken on a phone never is.
 * Three routes now, in the order they'll actually get used:
 *
 *   1. Straight off the phone. A plain file input with accept="image/*" is
 *      what makes iOS offer "Take Photo" alongside the camera roll, so one
 *      button covers both. Deliberately no capture attribute — that would
 *      force the camera and take the roll away.
 *   2. The studio gallery, which is the whole reason the artists send their
 *      work in: it's marketing material sitting there waiting to be used.
 *   3. A URL, kept for the rare case where the picture is already online.
 */
export default function PostImagePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: gallery } = trpc.uploads.list.useQuery(
    { unusedOnly: false },
    { enabled: showGallery }
  );

  async function upload(file: File) {
    setUploading(true);
    try {
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

      onChange(result.url);
      toast.success("Photo added");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUploading(false);
      // Clear it, so picking the same file twice still fires onChange.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <label className="text-sm">Photo (optional)</label>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      {value ? (
        <div className="relative w-fit">
          <img
            src={value}
            alt="The photo on this post"
            className="max-h-44 rounded-lg border border-border object-cover"
          />
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Remove this photo"
            className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-charcoal text-white shadow"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
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
                Take or choose a photo
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowGallery((open) => !open)}
          >
            <Images className="mr-2 h-3.5 w-3.5" />
            From studio gallery
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowUrl((open) => !open)}
          >
            <Link2 className="mr-2 h-3.5 w-3.5" />
            Paste a link
          </Button>
        </div>
      )}

      {!value && showUrl && (
        <Input
          placeholder="https://…"
          onChange={(e) => onChange(e.target.value)}
          className="border-border"
        />
      )}

      {!value && showGallery && (
        <div className="rounded-lg border border-border bg-surface p-2">
          {gallery?.length ? (
            <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
              {gallery.map((upload) => (
                <button
                  key={upload.id}
                  type="button"
                  onClick={() => {
                    onChange(upload.url);
                    setShowGallery(false);
                  }}
                  title={
                    upload.artistName ? `${upload.artistName}${upload.note ? ` — ${upload.note}` : ""}` : undefined
                  }
                  className="overflow-hidden rounded-md border border-border transition-transform hover:-translate-y-0.5 hover:border-sepia"
                >
                  <img
                    src={upload.url}
                    alt={upload.note || "Studio photo"}
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          ) : (
            <p className="p-2 text-xs text-muted-foreground">
              Nothing in the gallery yet — the artists' uploads land there.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
