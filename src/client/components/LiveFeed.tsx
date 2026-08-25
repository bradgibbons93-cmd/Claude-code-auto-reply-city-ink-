import { trpc } from "@/lib/trpc";
import { Heart, MessageCircle, Instagram, Facebook, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

/**
 * The studio's own posts, newest first — the rail that runs down the side of
 * the dashboard, and the same component the full Feed page renders wide.
 *
 * Images come from our stored copies, not Facebook's CDN, so a post from
 * three months ago still shows its picture.
 */
export default function LiveFeed({
  variant = "rail",
  limit,
}: {
  variant?: "rail" | "grid";
  limit?: number;
}) {
  const utils = trpc.useUtils();
  const { data: posts, isLoading } = trpc.feed.list.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
  });

  const refresh = trpc.feed.refresh.useMutation({
    onSuccess: (result) => {
      toast.success(result.detail);
      utils.feed.list.invalidate();
    },
    onError: (error) => toast.error(error.message || "Couldn't reach Facebook."),
  });

  const shown = limit ? posts?.slice(0, limit) : posts;

  if (isLoading) {
    return <p className="py-6 text-sm text-muted-foreground">Loading the feed…</p>;
  }

  if (!shown?.length) {
    return (
      <div className="space-y-3 py-6">
        <p className="text-sm text-muted-foreground">
          Nothing here yet. The feed fills itself in from the Page's own posts.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refresh.mutate({ days: 120 })}
          disabled={refresh.isPending}
        >
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
          {refresh.isPending ? "Pulling posts…" : "Pull in the last few months"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        className={
          variant === "grid"
            ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            : "space-y-4"
        }
      >
        {shown.map((post) => (
          <article
            key={post.id}
            className="overflow-hidden rounded-xl border border-border bg-surface"
          >
            {post.imagePath && (
              <a
                href={post.permalink ?? post.imagePath}
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src={post.imagePath}
                  alt={post.message?.slice(0, 120) || "Studio post"}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                />
              </a>
            )}

            <div className="space-y-2 p-3">
              <div className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                {post.source === "instagram" ? (
                  <Instagram className="h-3 w-3" />
                ) : (
                  <Facebook className="h-3 w-3" />
                )}
                <span>
                  {post.postedAt
                    ? formatDistanceToNow(new Date(post.postedAt), { addSuffix: true })
                    : ""}
                </span>
              </div>

              {post.message && (
                <p className="line-clamp-3 whitespace-pre-wrap text-sm text-charcoal">
                  {post.message}
                </p>
              )}

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Heart className="h-3 w-3" />
                  {post.likeCount ?? 0}
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  {post.commentCount ?? 0}
                </span>
              </div>
            </div>
          </article>
        ))}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => refresh.mutate({ days: 120 })}
        disabled={refresh.isPending}
      >
        <RefreshCw className={`mr-2 h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
        {refresh.isPending ? "Refreshing…" : "Refresh"}
      </Button>
    </div>
  );
}
