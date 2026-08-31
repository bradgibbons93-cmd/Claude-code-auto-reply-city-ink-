import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Calendar, Plus, Wand2, Trash2, Lightbulb, Clock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import PostPreview from "@/components/PostPreview";
import PostImagePicker from "@/components/PostImagePicker";
import PostCalendar from "@/components/PostCalendar";

const STATUS_STYLES: Record<string, string> = {
  published: "border-success/40 bg-success/10 text-success",
  scheduled: "border-blue-500/50 bg-blue-500/20 text-blue-400",
  draft: "border-sepia/45 bg-beige/30 text-charcoal",
  failed: "border-red-500/50 bg-red-500/20 text-red-400",
};

export default function PostScheduler() {
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const { data: posts, refetch } = trpc.posts.getScheduled.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const createPost = trpc.posts.create.useMutation({
    onSuccess: () => {
      toast.success("Post scheduled");
      setContent("");
      setScheduledAt("");
      setImageUrl("");
      setIsOpen(false);
      refetch();
    },
    onError: () => toast.error("Couldn't schedule that. Check the date and image URL."),
  });

  const generateCaption = trpc.posts.generateCaption.useMutation({
    onSuccess: (data) => {
      setContent(data.caption);
      toast.success("Caption written");
    },
    onError: () => toast.error("Caption generation failed. Check your AI key in Settings."),
  });

  const removePost = trpc.posts.remove.useMutation({
    onSuccess: () => {
      toast.success("Post deleted");
      refetch();
    },
    onError: () => toast.error("Couldn't delete that post."),
  });

  const suggest = trpc.posts.suggest.useMutation({
    onError: (error) =>
      toast.error(error.message || "Couldn't get suggestions. Check the AI connection in Settings."),
  });

  /** Opens the composer prefilled — from a suggestion or a tapped date. */
  const compose = (opts: { text?: string; date?: Date } = {}) => {
    if (opts.text) setContent(opts.text);
    if (opts.date) {
      // 11am is when the studio is open and people are on their phones.
      const at = new Date(opts.date);
      at.setHours(11, 0, 0, 0);
      setScheduledAt(format(at, "yyyy-MM-dd'T'HH:mm"));
    }
    setIsOpen(true);
  };

  const handleCreate = () => {
    if (!content.trim() || !scheduledAt) {
      toast.error("Add the post text and a time to publish.");
      return;
    }
    createPost.mutate({
      content,
      scheduledAt: new Date(scheduledAt),
      imageUrl: imageUrl || undefined,
      aiGenerated: false,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-display text-2xl text-charcoal">
            <Calendar className="h-5 w-5" />
            Posts
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Queued up for the City Ink Page. Published on the minute.
          </p>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New post
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl border-border bg-card">
            <DialogHeader>
              <DialogTitle className="text-charcoal">Schedule a post</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm">Post text</label>
                <Textarea
                  placeholder="Write it, or describe what you want and let the agent draft it."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="mt-2 min-h-32 border-border"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!content.trim()) {
                      toast.error("Describe the post first, then draft it.");
                      return;
                    }
                    generateCaption.mutate({ prompt: content });
                  }}
                  disabled={generateCaption.isPending}
                  className="mt-2"
                >
                  <Wand2 className="mr-2 h-4 w-4" />
                  {generateCaption.isPending ? "Writing…" : "Draft with AI"}
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-sm">Publish at</label>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="mt-2 border-border"
                  />
                </div>
                <PostImagePicker value={imageUrl} onChange={setImageUrl} />
              </div>

              {/* Live, while you type. Seeing where the caption breaks and
                  whether the picture is the wrong shape is the whole point —
                  after it's posted is too late to find out. */}
              <div>
                <p className="mb-2 text-[0.6rem] uppercase tracking-[0.18em] text-sepia">
                  How it will look
                </p>
                <PostPreview
                  content={content}
                  imageUrl={imageUrl || null}
                  scheduledAt={scheduledAt || null}
                />
              </div>

              <Button onClick={handleCreate} disabled={createPost.isPending} className="w-full">
                {createPost.isPending ? "Scheduling…" : "Schedule post"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-border">
        <CardContent className="pt-6">
          <PostCalendar posts={posts ?? []} onPickDate={(date) => compose({ date })} />
          <p className="mt-3 text-xs text-muted-foreground">
            Tap a day to schedule something for it.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 font-display text-lg text-charcoal">
                <Lightbulb className="h-4 w-4 text-sepia" />
                Ideas for the week
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Built from what's in Training, so it won't invent a price or a free slot.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => suggest.mutate()}
              disabled={suggest.isPending}
            >
              {suggest.isPending ? "Thinking…" : "Suggest"}
            </Button>
          </div>

          {suggest.data?.map((idea, i) => (
            <div key={i} className="rounded-xl border border-border p-3">
              <p className="text-sm text-charcoal">{idea.hook}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                {idea.caption}
              </p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {idea.bestTime}
                </span>
                <Button size="sm" variant="ghost" onClick={() => compose({ text: idea.caption })}>
                  Use this
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {posts?.length ? (
          posts.map((post) => (
            <Card key={post.id} className="border-border">
              <CardContent className="pt-6">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={STATUS_STYLES[post.status]}>{post.status}</Badge>
                    {post.aiGenerated && (
                      <Badge className="border-purple-500/50 bg-purple-500/20 text-purple-400">
                        AI drafted
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removePost.mutate({ id: post.id })}
                    disabled={removePost.isPending}
                    aria-label="Delete post"
                    className="text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* The post as it will actually land, not a text blob. */}
                <PostPreview
                  content={post.content}
                  imageUrl={post.imageUrl}
                  scheduledAt={post.scheduledAt}
                />

                <p className="mt-3 text-sm text-muted-foreground">
                  {post.status === "published" ? "Published" : "Publishing"}{" "}
                  <span className="text-charcoal">
                    {format(new Date(post.scheduledAt), "d MMM yyyy, HH:mm")}
                  </span>
                </p>

                {post.status === "failed" && post.lastError && (
                  // Explained server-side now, so this is a sentence rather than a
                  // Graph dump — "Facebook said:" in front of it read like the
                  // app was quoting an error it hadn't understood.
                  <p className="mt-2 text-sm text-red-400">{post.lastError}</p>
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="border-border">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Nothing queued.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
