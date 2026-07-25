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
import { Calendar, Plus, Wand2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
  published: "border-green-500/50 bg-green-500/20 text-green-400",
  scheduled: "border-blue-500/50 bg-blue-500/20 text-blue-400",
  draft: "border-amber-500/50 bg-amber-500/20 text-amber-400",
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
          <h2 className="flex items-center gap-2 font-serif text-2xl text-amber-400">
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
          <DialogContent className="max-w-2xl border-amber-500/20 bg-card">
            <DialogHeader>
              <DialogTitle className="text-amber-400">Schedule a post</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm">Post text</label>
                <Textarea
                  placeholder="Write it, or describe what you want and let the agent draft it."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="mt-2 min-h-32 border-amber-500/20"
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
                    className="mt-2 border-amber-500/20"
                  />
                </div>
                <div>
                  <label className="text-sm">Image URL (optional)</label>
                  <Input
                    placeholder="https://…"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="mt-2 border-amber-500/20"
                  />
                </div>
              </div>

              <Button onClick={handleCreate} disabled={createPost.isPending} className="w-full">
                {createPost.isPending ? "Scheduling…" : "Schedule post"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4">
        {posts?.length ? (
          posts.map((post) => (
            <Card key={post.id} className="border-amber-500/20">
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

                <p className="mb-3 whitespace-pre-wrap">{post.content}</p>

                {post.imageUrl && (
                  <img
                    src={post.imageUrl}
                    alt=""
                    className="mb-3 max-h-32 rounded border border-amber-500/20"
                  />
                )}

                <p className="text-sm text-muted-foreground">
                  {post.status === "published" ? "Published" : "Publishing"}{" "}
                  <span className="text-amber-400">
                    {format(new Date(post.scheduledAt), "d MMM yyyy, HH:mm")}
                  </span>
                </p>

                {post.status === "failed" && post.lastError && (
                  <p className="mt-2 text-sm text-red-400">Facebook said: {post.lastError}</p>
                )}
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="border-amber-500/20">
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Nothing queued.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
