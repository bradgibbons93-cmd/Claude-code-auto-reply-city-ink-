import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Check, Copy, Download, Move, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import PhotoViewer from "@/components/PhotoViewer";
import ReframeEditor, { parseFraming } from "@/components/ReframeEditor";

type Post = {
  id: number;
  content: string;
  imageUrl: string | null;
  storyUrl?: string | null;
  uploadId?: string | null;
  framing?: string | null;
  scheduledAt: string | Date;
};

/**
 * Posts the auto-post made from the artists' uploads (server/autopost.ts),
 * waiting for the studio's OK. They are status "review" on the server and the
 * publisher will not touch them until Approve is pressed — so this card is
 * the only door they go out through.
 *
 * Save square, Save story and Copy caption are here because Facebook posting is still
 * waiting on Meta's review, and Instagram posting isn't something Runnit can
 * do at all yet: the branded photo and its caption are useful today, by hand.
 */
export default function ReviewPosts({ posts, onChange }: { posts: Post[]; onChange: () => void }) {
  const [edits, setEdits] = useState<Record<number, { content?: string; when?: string }>>({});
  const [open, setOpen] = useState<string | null>(null);
  // The post whose photo is being moved, if any. One at a time.
  const [moving, setMoving] = useState<number | null>(null);

  const approve = trpc.posts.approve.useMutation({
    onSuccess: (data) => {
      toast.success(`Approved. Goes out ${format(new Date(data.scheduledAt), "EEE d MMM 'at' h:mmaaa")}.`);
      onChange();
    },
    onError: (error) => toast.error(error.message || "Couldn't approve that one."),
  });

  const remove = trpc.posts.remove.useMutation({
    onSuccess: () => {
      toast("Removed. The photo is back in the gallery.");
      onChange();
    },
    onError: () => toast.error("Couldn't remove that one."),
  });

  if (!posts.length) return null;

  const edit = (id: number, patch: { content?: string; when?: string }) =>
    setEdits((all) => ({ ...all, [id]: { ...all[id], ...patch } }));

  return (
    <Card className="border-sepia/50" data-testid="review-posts">
      <CardContent className="space-y-4 pt-6">
        <div>
          <p className="font-display text-lg text-charcoal">Waiting for your OK ({posts.length})</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Made from the artists' uploads: logo on, colour touched up, caption written. Nothing
            goes out until you approve it.{" "}
            <Link href="/gallery" className="text-sepia underline-offset-2 hover:underline">
              Change the logo spot
            </Link>
          </p>
        </div>

        {posts.map((post) => {
          const content = edits[post.id]?.content ?? post.content;
          const when = edits[post.id]?.when ?? format(new Date(post.scheduledAt), "yyyy-MM-dd'T'HH:mm");
          const busy = approve.isPending || remove.isPending;
          return (
            <div
              key={post.id}
              data-testid="review-post"
              className="grid gap-4 rounded-2xl border border-border p-3 sm:grid-cols-[minmax(0,300px)_1fr]"
            >
              {moving === post.id && post.uploadId ? (
                <ReframeEditor
                  postId={post.id}
                  uploadId={post.uploadId}
                  framing={parseFraming(post.framing)}
                  onCancel={() => setMoving(null)}
                  onDone={() => {
                    setMoving(null);
                    onChange();
                  }}
                />
              ) : post.imageUrl ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_0.42fr] items-start gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(post.imageUrl)}
                      className="overflow-hidden rounded-xl bg-elevated"
                      aria-label="Open the square post"
                    >
                      <img src={post.imageUrl} alt="The square post with the logo on" className="aspect-square w-full object-cover" />
                    </button>
                    {post.storyUrl && (
                      <button
                        type="button"
                        onClick={() => setOpen(post.storyUrl ?? null)}
                        className="overflow-hidden rounded-xl bg-elevated"
                        aria-label="Open the story"
                      >
                        <img src={post.storyUrl} alt="The Instagram story version" className="aspect-[9/16] w-full object-cover" />
                      </button>
                    )}
                  </div>
                  {post.uploadId && (
                    <Button
                      variant="outline"
                      className="min-h-[44px] w-full"
                      disabled={busy}
                      onClick={() => setMoving(post.id)}
                    >
                      <Move className="mr-2 h-4 w-4" />
                      Move photo
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid min-h-32 place-items-center rounded-xl bg-elevated text-sm text-muted-foreground">
                  No photo
                </div>
              )}

              <div className="min-w-0 space-y-3">
                <div>
                  <label htmlFor={`caption-${post.id}`} className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Caption
                  </label>
                  <Textarea
                    id={`caption-${post.id}`}
                    value={content}
                    onChange={(e) => edit(post.id, { content: e.target.value })}
                    className="mt-1 min-h-24 border-border"
                  />
                </div>
                <div>
                  <label htmlFor={`when-${post.id}`} className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    Goes out
                  </label>
                  <Input
                    id={`when-${post.id}`}
                    type="datetime-local"
                    value={when}
                    onChange={(e) => edit(post.id, { when: e.target.value })}
                    className="mt-1 border-border"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy || !content.trim()}
                    onClick={() =>
                      approve.mutate({
                        id: post.id,
                        content,
                        scheduledAt: when ? new Date(when) : undefined,
                      })
                    }
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(content)
                        .then(() => toast.success("Caption copied"))
                        .catch(() => toast.error("Couldn't copy. Select it by hand."))
                    }
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy caption
                  </Button>
                  {post.imageUrl && (
                    <a
                      href={post.imageUrl}
                      download={`post-${post.id}-square.jpg`}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium text-charcoal transition-all hover:border-sepia hover:bg-beige/20"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Save square
                    </a>
                  )}
                  {post.storyUrl && (
                    <a
                      href={post.storyUrl}
                      download={`post-${post.id}-story.jpg`}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-medium text-charcoal transition-all hover:border-sepia hover:bg-beige/20"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Save story
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => remove.mutate({ id: post.id })}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>

      {open && (
        <PhotoViewer urls={[open]} index={0} onClose={() => setOpen(null)} onIndex={() => undefined} alt="Post photo" />
      )}
    </Card>
  );
}
