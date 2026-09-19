import { and, gte, lte, ne } from "drizzle-orm";
import { getDb } from "./db.js";
import { scheduledPosts } from "../drizzle/schema.js";
import { generateCaption } from "./agent.js";
import { listArtistUploads, markUploadUsed } from "./uploads.js";

/**
 * A run of photos turned into a run of days.
 *
 * The studio's actual problem: an artist finishes a piece, photographs it,
 * and it sits in the gallery. A week later there are eleven of them and the
 * Page hasn't been posted to once, because scheduling them means opening the
 * composer eleven times and typing a date into eleven date pickers.
 *
 * So: pick the lot, say when to start, and the app lays them out a day
 * apart. Everything after that is the ordinary scheduler — these are plain
 * rows in scheduled_posts, editable and deletable one by one, and Brad can
 * still change or delete any of them before it goes out.
 */

export interface BulkItem {
  /** Where the picture lives — a gallery path or an uploaded post image. */
  imageUrl: string;
  /** The typed caption for this one, if there is one. */
  caption?: string;
  /** The artist's own note, used as the brief when the AI writes captions. */
  note?: string;
  artistName?: string;
  /** Set when the photo came from the studio gallery, so it can be marked used. */
  uploadId?: string;
}

export interface BulkOptions {
  /** The day the first one goes out (local server time). */
  startDate: Date;
  /** 24-hour "HH:MM". The hour of day every post in the run lands on. */
  timeOfDay: string;
  /** Days between posts. One a day is the default and the ask. */
  spacingDays?: number;
  /** A caption used for any photo that doesn't have its own. */
  sharedCaption?: string;
  /** Let the agent write each caption from the artist's note. */
  writeCaptions?: boolean;
  /** Step over a day that already has something queued, rather than doubling up. */
  avoidClashes?: boolean;
}

export interface PlannedPost {
  imageUrl: string;
  caption: string;
  scheduledAt: Date;
  aiGenerated: boolean;
  uploadId?: string;
}

/** Fallbacks, in order, so a photo can never end up with an empty caption. */
const FALLBACK_CAPTIONS = [
  "Fresh out of the studio. City Ink, Geelong.",
  "New work off the table today.",
  "Healed and settled. City Ink, Geelong.",
  "Another one finished this week.",
];

export class BulkRejected extends Error {}

/** "14:30" → { hours: 14, minutes: 30 }. Anything odd falls back to 11am. */
export function parseTimeOfDay(value: string | undefined): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!match) return { hours: 11, minutes: 0 };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return { hours: 11, minutes: 0 };
  return { hours, minutes };
}

function atTime(day: Date, time: { hours: number; minutes: number }): Date {
  const at = new Date(day);
  at.setHours(time.hours, time.minutes, 0, 0);
  return at;
}

function addDays(day: Date, count: number): Date {
  const next = new Date(day);
  next.setDate(next.getDate() + count);
  return next;
}

/** Midnight-to-midnight key, so two times on the same day collide. */
function dayKey(at: Date): string {
  return `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}`;
}

/**
 * The dates, worked out on their own so the spacing can be tested without a
 * database, a Graph server or a model.
 *
 * Two rules that only show up in use:
 *
 *   - A start time already gone is not a post that fires the moment it's
 *     saved. Picking "today" at 11am at four in the afternoon should mean
 *     tomorrow, not eleven posts all going out at once tonight.
 *   - A day that already has something queued gets stepped over, so a bulk
 *     run laid over an existing week doesn't put two posts out on the
 *     Wednesday.
 */
export function planDates(
  count: number,
  options: {
    startDate: Date;
    timeOfDay: string;
    spacingDays?: number;
    takenDays?: Set<string>;
    now?: Date;
  }
): Date[] {
  const time = parseTimeOfDay(options.timeOfDay);
  const spacing = Math.max(1, Math.min(30, Math.floor(options.spacingDays ?? 1)));
  const now = options.now ?? new Date();
  const taken = options.takenDays ?? new Set<string>();

  let day = new Date(options.startDate);
  day.setHours(0, 0, 0, 0);

  // Never schedule into the past. A slot that has already gone rolls forward.
  while (atTime(day, time).getTime() <= now.getTime()) day = addDays(day, 1);

  const dates: Date[] = [];
  // A generous ceiling on the search, so a densely booked calendar can't
  // spin here forever — it runs out of room and stops instead.
  const limit = count * spacing + taken.size + 400;
  let steps = 0;

  while (dates.length < count && steps < limit) {
    steps += 1;
    if (taken.has(dayKey(day))) {
      day = addDays(day, 1);
      continue;
    }
    dates.push(atTime(day, time));
    taken.add(dayKey(day));
    day = addDays(day, spacing);
  }

  return dates;
}

/** The days that already carry a post, so the run can step over them. */
async function daysAlreadyBooked(from: Date, to: Date): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db
    .select({ scheduledAt: scheduledPosts.scheduledAt })
    .from(scheduledPosts)
    .where(
      and(
        gte(scheduledPosts.scheduledAt, from),
        lte(scheduledPosts.scheduledAt, to),
        // A post that already failed isn't occupying its day in any useful
        // sense — stepping over it would leave a hole for no reason.
        ne(scheduledPosts.status, "failed")
      )
    );
  return new Set(rows.map((row) => dayKey(new Date(row.scheduledAt))));
}

/** The caption for one photo: typed, then the artist's note, then AI, then a stock line. */
async function captionFor(
  item: BulkItem,
  index: number,
  options: BulkOptions
): Promise<{ caption: string; aiGenerated: boolean }> {
  const typed = item.caption?.trim() || options.sharedCaption?.trim();
  if (typed && !options.writeCaptions) return { caption: typed, aiGenerated: false };

  if (options.writeCaptions) {
    // The brief is whatever the studio actually knows about this photo. The
    // model can't see the picture, so inventing detail from nothing is the
    // one thing it must not do — the note is what keeps it honest.
    const brief = [
      item.note?.trim(),
      item.artistName ? `Tattooed by ${item.artistName}.` : undefined,
      typed,
    ]
      .filter(Boolean)
      .join(" ");

    try {
      const caption = await generateCaption(
        brief ||
          "A photo of a tattoo finished in the studio this week. Write a short caption that doesn't describe the design, since you can't see it."
      );
      if (caption.trim()) return { caption: caption.trim(), aiGenerated: true };
    } catch {
      // Fall through. One model hiccup must not lose the whole batch.
    }
  }

  if (typed) return { caption: typed, aiGenerated: false };
  if (item.note?.trim()) return { caption: item.note.trim(), aiGenerated: false };
  return { caption: FALLBACK_CAPTIONS[index % FALLBACK_CAPTIONS.length], aiGenerated: false };
}

/**
 * Turn the picked photos into scheduled posts — one a day — and hand back
 * what was queued so the dashboard can show the plan rather than a count.
 */
export async function bulkSchedule(
  items: BulkItem[],
  options: BulkOptions
): Promise<{ scheduled: PlannedPost[] }> {
  if (!items.length) throw new BulkRejected("Pick at least one photo first.");
  if (items.length > 60) throw new BulkRejected("Sixty photos in one run is the limit.");

  const spacing = Math.max(1, Math.min(30, Math.floor(options.spacingDays ?? 1)));

  let taken: Set<string> | undefined;
  if (options.avoidClashes !== false) {
    const from = new Date(options.startDate);
    from.setHours(0, 0, 0, 0);
    // Far enough ahead to cover the whole run even if every day is busy.
    const to = new Date(from);
    to.setDate(to.getDate() + items.length * spacing + 90);
    taken = await daysAlreadyBooked(from, to).catch(() => new Set<string>());
  }

  const dates = planDates(items.length, {
    startDate: options.startDate,
    timeOfDay: options.timeOfDay,
    spacingDays: spacing,
    takenDays: taken,
  });

  if (dates.length < items.length) {
    throw new BulkRejected(
      "Couldn't find a free day for every photo — clear some of what's already queued, or start later."
    );
  }

  const planned: PlannedPost[] = [];
  for (const [index, item] of items.entries()) {
    const { caption, aiGenerated } = await captionFor(item, index, options);
    planned.push({
      imageUrl: item.imageUrl,
      caption,
      scheduledAt: dates[index],
      aiGenerated,
      uploadId: item.uploadId,
    });
  }

  const db = await getDb();
  await db.insert(scheduledPosts).values(
    planned.map((post) => ({
      content: post.caption,
      imageUrl: post.imageUrl,
      scheduledAt: post.scheduledAt,
      aiGenerated: post.aiGenerated,
      status: "scheduled" as const,
    }))
  );

  // Mark the gallery photos as used, so the next bulk run doesn't offer the
  // same pictures back. Best-effort — a post is queued either way.
  for (const post of planned) {
    if (post.uploadId) await markUploadUsed(post.uploadId, true).catch(() => undefined);
  }

  return { scheduled: planned };
}

/** Fill in note and artist for gallery picks, so AI captions have a brief. */
export async function describeUploads(ids: string[]): Promise<Map<string, BulkItem>> {
  if (!ids.length) return new Map();
  const rows = await listArtistUploads({ limit: 500 });
  const wanted = new Set(ids);
  const found = new Map<string, BulkItem>();
  for (const row of rows) {
    if (!wanted.has(row.id)) continue;
    found.set(row.id, {
      imageUrl: row.url,
      note: row.note ?? undefined,
      artistName: row.artistName ?? undefined,
      uploadId: row.id,
    });
  }
  return found;
}
