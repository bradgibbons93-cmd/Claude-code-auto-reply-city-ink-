import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, Images, Link2, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import PhotoEditor, { type PhotoEdit } from "@/components/PhotoEditor";

/** Photos this app holds the original of, which the editor can work from. */
const editable = (url: string) => /^\/api\/(uploads|attachments)\/[0-9a-f]{40}$/.test(url);

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

  // The photo as it was picked, and the last edit of it. `value` is what the
  // post will carry — the edited picture once there is one — but every edit
  // starts again from the original, so editing twice never crops a crop.
  const [original, setOriginal] = useState<string | null>(null);
  const [edited, setEdited] = useState<{ url: string; edit: PhotoEdit } | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!value) {
      setOriginal(null);
      setEdited(null);
    } else if (value !== original && value !== edited?.url) {
      // A new photo, from any of the three routes.
      setOriginal(value);
      setEdited(null);
    }
  }, [value, original, edited]);
  const source = original ?? value;

  const editPhoto = trpc.posts.editPhoto.useMutation();
  const saveEdit = async (edit: PhotoEdit) => {
    try {
      const spot = edit.spots[edit.format];
      const result = await editPhoto.mutateAsync({
        source,
        format: edit.format,
        spot: spot ?? { x: 0.5, y: 0.5 },
        style: { adjust: edit.adjust, logo: edit.logo },
      });
      setEdited({ url: result.url, edit });
      onChange(result.url);
      setEditing(false);
      toast.success(edit.logo.on ? "Photo ready, logo on." : "Photo ready.");
    } catch (error) {
      toast.error((error as Error).message || "Couldn't finish that photo. Try again.");
      throw error;
    }
  };

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
        <div className="w-fit max-w-full space-y-2" data-testid="post-photo">
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
              className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-charcoal text-white shadow"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Brad: "a little pop up tab or text either under or on the photo as
              a button ... edit or add logo and post". */}
          {editable(source) ? (
            <Button
              type="button"
              variant={edited ? "outline" : "default"}
              className="min-h-[44px] w-full"
              onClick={() => setEditing(true)}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {edited ? "Edit again" : "Edit & add logo"}
            </Button>
          ) : (
            <p className="max-w-[16rem] text-xs text-muted-foreground">
              A link from another site can't be edited here. Upload the photo to add the logo.
            </p>
          )}
          {editing && (
            <PhotoEditor
              title="Get it ready to post"
              source={source}
              formats={["square", "portrait"]}
              mode="pick"
              start={edited?.edit}
              saveLabel="Use this photo"
              onCancel={() => setEditing(false)}
              onSave={saveEdit}
            />
          )}
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
