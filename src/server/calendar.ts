import ical, { type VEvent } from "node-ical";
import { getTimelyConfig } from "./db.js";

/**
 * Availability comes from Google Calendar, not Timely's API.
 *
 * Timely syncs appointments into the studio's Google Calendar, and Google
 * exposes any calendar as a private iCal feed ("secret address in iCal
 * format"). Reading that needs a URL and nothing else — no OAuth app, no
 * developer account, no API plan — which is why it's the route here.
 *
 * It is read-only by design. The agent proposes times it can see are free;
 * the booking itself is still made by a person, which is what Brad asked
 * for anyway since every reply goes through him.
 */

/** Studio hours, local time. Saturday included; Sunday closed. */
const OPENING = { startHour: 10, startMinute: 30, endHour: 17 };
const CLOSED_WEEKDAYS = [0]; // Sunday

/** Default appointment length when we don't know how long a piece will take. */
const DEFAULT_SLOT_MINUTES = 90;

/** Don't offer anything sooner than this — nobody can get there in 10 minutes. */
const MIN_NOTICE_MINUTES = 120;

const TIMEZONE = process.env.STUDIO_TIMEZONE || "Australia/Melbourne";

export interface FreeSlot {
  start: Date;
  end: Date;
  label: string;
}

interface BusyBlock {
  start: Date;
  end: Date;
  title?: string;
}

/**
 * How far the studio's wall clock is from UTC at a given instant. Railway
 * runs the server in UTC, so without this every slot was generated in the
 * wrong timezone — 10:30 "opening" came out as 8:30pm Geelong time.
 * Derived from Intl rather than hardcoded so daylight saving is handled.
 */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return asUtc - at.getTime();
}

/**
 * Minutes since midnight on the studio's wall clock.
 *
 * Exported because `push.ts` needs exactly this and got it wrong by reaching
 * for `Date.getHours()`, which is the server's clock — UTC on Railway. The
 * same mistake this file's own `offsetMs` comment describes, made again a
 * month later in another file. One place for it now.
 */
export function studioMinutesOfDay(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return (get("hour") % 24) * 60 + get("minute");
}

/** The studio's timezone, so a diagnosis can say which clock it used. */
export function studioTimezone(): string {
  return TIMEZONE;
}

/** The UTC instant matching a wall-clock time in the studio's timezone. */
function studioTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): Date {
  const naive = Date.UTC(year, month, day, hour, minute);
  // Correct twice: the first offset may be from the wrong side of a DST edge.
  const first = new Date(naive - offsetMs(new Date(naive), TIMEZONE));
  return new Date(naive - offsetMs(first, TIMEZONE));
}

/** Calendar date parts as they read on the studio's wall clock. */
function studioDateParts(at: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(get("year")),
    month: Number(get("month")) - 1,
    day: Number(get("day")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

/** Formats a slot the way the studio says it: "Tuesday the 12th at 11am". */
function describeSlot(start: Date): string {
  const weekday = start.toLocaleDateString("en-AU", { weekday: "long", timeZone: TIMEZONE });
  const day = Number(start.toLocaleDateString("en-AU", { day: "numeric", timeZone: TIMEZONE }));
  const suffix =
    day % 10 === 1 && day !== 11
      ? "st"
      : day % 10 === 2 && day !== 12
        ? "nd"
        : day % 10 === 3 && day !== 13
          ? "rd"
          : "th";
  const time = start
    .toLocaleTimeString("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: TIMEZONE,
    })
    .replace(":00", "")
    .replace(/\s/g, "")
    .toLowerCase();
  return `${weekday} the ${day}${suffix} at ${time}`;
}

/** Pulls busy blocks out of the iCal feed, expanding weekly/daily repeats. */
async function fetchBusyBlocks(icsUrl: string, from: Date, to: Date): Promise<BusyBlock[]> {
  const events = await ical.async.fromURL(icsUrl);
  const busy: BusyBlock[] = [];

  for (const event of Object.values(events)) {
    if (!event || (event as VEvent).type !== "VEVENT") continue;
    const vevent = event as VEvent;
    if (!vevent.start || !vevent.end) continue;

    const durationMs = new Date(vevent.end).getTime() - new Date(vevent.start).getTime();

    if (vevent.rrule) {
      // Recurring: take the occurrences that land in our window.
      for (const occurrence of vevent.rrule.between(from, to, true)) {
        busy.push({
          start: occurrence,
          end: new Date(occurrence.getTime() + durationMs),
          title: summaryText(vevent.summary),
        });
      }
      continue;
    }

    const start = new Date(vevent.start);
    const end = new Date(vevent.end);
    if (end > from && start < to) busy.push({ start, end, title: summaryText(vevent.summary) });
  }

  return busy;
}

/** node-ical types SUMMARY as either a plain string or a {val, params} pair. */
function summaryText(summary: VEvent["summary"]): string | undefined {
  if (typeof summary === "string") return summary;
  if (summary && typeof summary === "object" && "val" in summary) return String(summary.val);
  return undefined;
}

function overlaps(slotStart: Date, slotEnd: Date, busy: BusyBlock[]): boolean {
  return busy.some((b) => slotStart < b.end && slotEnd > b.start);
}

/**
 * Walks forward day by day, skipping closed days and anything already in the
 * calendar, and returns the first few genuinely open slots.
 */
export async function findFreeSlots(options?: {
  slotMinutes?: number;
  limit?: number;
  daysAhead?: number;
}): Promise<FreeSlot[]> {
  const config = await getTimelyConfig().catch(() => undefined);
  if (!config?.calendarIcsUrl) return [];

  const slotMinutes = options?.slotMinutes ?? DEFAULT_SLOT_MINUTES;
  const limit = options?.limit ?? 3;
  const daysAhead = options?.daysAhead ?? 14;

  const now = new Date();
  const earliest = new Date(now.getTime() + MIN_NOTICE_MINUTES * 60_000);
  const horizon = new Date(now.getTime() + daysAhead * 24 * 60 * 60_000);

  let busy: BusyBlock[];
  try {
    busy = await fetchBusyBlocks(config.calendarIcsUrl, now, horizon);
  } catch (error) {
    // A calendar we can't read must never turn into invented availability.
    console.error("[Calendar] Couldn't read the feed:", (error as Error).message);
    return [];
  }

  const slots: FreeSlot[] = [];

  for (let day = 0; day <= daysAhead && slots.length < limit; day++) {
    // Step a day at a time and re-read the studio's calendar date, so the
    // opening hours below are anchored to Geelong's clock, not the server's.
    const { year, month, day: dayOfMonth, weekday } = studioDateParts(
      new Date(now.getTime() + day * 24 * 60 * 60_000)
    );
    if (CLOSED_WEEKDAYS.includes(weekday)) continue;

    const dayStart = studioTime(year, month, dayOfMonth, OPENING.startHour, OPENING.startMinute);
    const dayEnd = studioTime(year, month, dayOfMonth, OPENING.endHour, 0);

    // Step in half hours so suggestions land on natural times.
    for (
      let t = new Date(dayStart);
      t.getTime() + slotMinutes * 60_000 <= dayEnd.getTime() && slots.length < limit;
      t = new Date(t.getTime() + 30 * 60_000)
    ) {
      if (t < earliest) continue;
      const slotEnd = new Date(t.getTime() + slotMinutes * 60_000);
      if (overlaps(t, slotEnd, busy)) continue;

      slots.push({ start: new Date(t), end: slotEnd, label: describeSlot(t) });
      // One suggestion per day reads better than three on the same morning.
      break;
    }
  }

  return slots;
}

/**
 * How long a sitting runs, and therefore how big a gap it actually needs.
 *
 * A full day means the studio day — 10:30 to 5 — so "full day free" can only
 * be a day with nothing else in it at all. That's the point: a 90-minute hole
 * between an 11am booking and a 3pm appointment is not a day.
 */
export const SESSION_LENGTHS = [
  { key: "short", minutes: 90, label: "Short sitting — up to 1.5 hrs" },
  { key: "half", minutes: 180, label: "Half day — 3 hrs straight" },
  {
    key: "full",
    minutes: (OPENING.endHour * 60) - (OPENING.startHour * 60 + OPENING.startMinute),
    label: "Full day — the whole day, nothing else booked",
  },
] as const;

/**
 * Availability for the prompt, broken down by how long the session needs.
 *
 * Previously this only ever asked for a 90-minute gap, so a customer wanting
 * a big piece over several sessions was offered a slot that happened to have
 * an hour and a half free between two other appointments. The agent has no
 * way to tell a gap from a day unless it's told, so it gets all three and is
 * told to pick the row that matches.
 */
export async function availabilityForPrompt(): Promise<string> {
  const rows = await Promise.all(
    SESSION_LENGTHS.map(async (length) => {
      const slots = await findFreeSlots({ slotMinutes: length.minutes, limit: 3 });
      return { ...length, slots };
    })
  );

  if (rows.every((row) => row.slots.length === 0)) return "";

  return rows
    .map(
      (row) =>
        `- ${row.label}: ${
          row.slots.length
            ? row.slots.map((s) => s.label).join(", ")
            : "nothing free in the next fortnight"
        }`
    )
    .join("\n");
}

export interface UpcomingBooking {
  title: string;
  start: Date;
  label: string;
}

/**
 * The next few appointments already in the calendar. Read-only, same feed as
 * availability — this is what fills the Upcoming Bookings panel rather than
 * a separate bookings table the studio would have to maintain twice.
 */
export async function getUpcomingBookings(limit = 6): Promise<UpcomingBooking[]> {
  const config = await getTimelyConfig().catch(() => undefined);
  if (!config?.calendarIcsUrl) return [];

  const now = new Date();
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60_000);

  try {
    const blocks = await fetchBusyBlocks(config.calendarIcsUrl, now, horizon);
    return blocks
      .filter((b) => b.start >= now)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(0, limit)
      .map((b) => ({
        title: b.title || "Appointment",
        start: b.start,
        label: describeSlot(b.start),
      }));
  } catch (error) {
    console.error("[Calendar] Couldn't read upcoming bookings:", (error as Error).message);
    return [];
  }
}
