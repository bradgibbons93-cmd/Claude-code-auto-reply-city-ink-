import { format } from "date-fns";
import { Globe, MoreHorizontal, ThumbsUp, MessageCircle, Share2 } from "lucide-react";
import { StampBadge } from "@/components/Logo";

/**
 * The post as Facebook will actually render it.
 *
 * A caption in a textarea tells you nothing about how it lands — where the
 * line breaks fall, whether the picture is the wrong shape, whether it reads
 * as too long. This is the same content in the same shape the customer will
 * see it, so a bad post is obvious before it goes out rather than after.
 *
 * Deliberately Facebook's furniture and not the studio's: the point is to
 * look like the destination, not like the rest of this app.
 */
export default function PostPreview({
  content,
  imageUrl,
  scheduledAt,
  pageName = "City Ink Tattoo",
}: {
  content: string;
  imageUrl?: string | null;
  scheduledAt?: string | Date | null;
  pageName?: string;
}) {
  const when = scheduledAt ? new Date(scheduledAt) : null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-elevated shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-2.5 p-3">
        <StampBadge className="h-9 w-9 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-charcoal">{pageName}</p>
          <p className="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
            {when ? format(when, "d MMM 'at' h:mma").replace("AM", "am").replace("PM", "pm") : "Not scheduled"}
            <span aria-hidden="true">·</span>
            <Globe className="h-3 w-3" />
          </p>
        </div>
        <MoreHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      {content.trim() ? (
        <p className="whitespace-pre-wrap px-3 pb-3 text-sm leading-relaxed text-charcoal">
          {content}
        </p>
      ) : (
        <p className="px-3 pb-3 text-sm italic text-muted-foreground">
          Your caption will appear here.
        </p>
      )}

      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="max-h-80 w-full border-y border-border bg-surface object-cover"
        />
      ) : (
        <div className="flex h-32 items-center justify-center border-y border-border bg-surface text-xs text-muted-foreground">
          No image on this post
        </div>
      )}

      {/* Not real numbers — the bar is here so the layout reads as a post. */}
      <div className="flex items-center justify-around px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ThumbsUp className="h-3.5 w-3.5" />
          Like
        </span>
        <span className="flex items-center gap-1.5">
          <MessageCircle className="h-3.5 w-3.5" />
          Comment
        </span>
        <span className="flex items-center gap-1.5">
          <Share2 className="h-3.5 w-3.5" />
          Share
        </span>
      </div>
    </div>
  );
}
