import { useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Post {
  id: number;
  content: string;
  scheduledAt: string | Date;
  status: string;
}

const DOT: Record<string, string> = {
  published: "bg-success",
  scheduled: "bg-sepia",
  draft: "bg-muted-foreground",
  failed: "bg-destructive",
};

/**
 * A month at a glance, so gaps in the schedule are visible. Weeks start on
 * Monday — the studio is closed Sundays, so a Sunday-first grid puts the one
 * dead day at the front of every row.
 */
export default function PostCalendar({
  posts,
  onPickDate,
}: {
  posts: Post[];
  onPickDate?: (date: Date) => void;
}) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });

  const postsOn = (day: Date) =>
    posts.filter((p) => isSameDay(new Date(p.scheduledAt), day));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display text-lg text-charcoal">{format(month, "MMMM yyyy")}</p>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMonth(subMonths(month, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMonth(addMonths(month, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="pb-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const dayPosts = postsOn(day);
          const outside = !isSameMonth(day, month);
          return (
            <button
              key={day.toISOString()}
              onClick={() => onPickDate?.(day)}
              className={`min-h-16 rounded-lg border p-1.5 text-left transition-colors ${
                isToday(day) ? "border-sepia" : "border-border"
              } ${outside ? "opacity-40" : ""} hover:border-sepia/50`}
            >
              <span className="text-xs text-charcoal">{format(day, "d")}</span>
              <div className="mt-1 space-y-0.5">
                {dayPosts.slice(0, 2).map((p) => (
                  <div key={p.id} className="flex items-center gap-1">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[p.status] ?? "bg-muted-foreground"}`}
                    />
                    <span className="truncate text-[10px] text-muted-foreground">
                      {p.content.slice(0, 18)}
                    </span>
                  </div>
                ))}
                {dayPosts.length > 2 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{dayPosts.length - 2} more
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
