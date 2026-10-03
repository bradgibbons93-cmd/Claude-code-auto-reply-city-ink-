import ical, { type CalendarResponse, type VEvent } from "node-ical";
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
export function studioTime(
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
export function studioDateParts(at: Date): { year: number; month: number; day: number; weekday: number } {
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

/*
 * One read of the feed serves a whole draft. availabilityForPrompt asks for
 * three session lengths, the free-days list and any named dates — five
 * downloads and parses of what can be years of Google Calendar history, for
 * one reply, inside a poll that has a two-minute budget. A minute is short
 * enough that a booking made in Timely shows up by the next draft.
 */
const FEED_TTL_MS = 60_000;
let feedCache: { url: string; at: number; events: Promise<CalendarResponse> } | undefined;

function readFeed(icsUrl: string): Promise<CalendarResponse> {
  if (feedCache && feedCache.url === icsUrl && Date.now() - feedCache.at < FEED_TTL_MS) {
    return feedCache.events;
  }
  const events = ical.async.fromURL(icsUrl);
  feedCache = { url: icsUrl, at: Date.now(), events };
  // A failed read must not be remembered — the next draft tries again.
  events.catch(() => {
    if (feedCache?.events === events) feedCache = undefined;
  });
  return events;
}

/** Pulls busy blocks out of the iCal feed, expanding weekly/daily repeats. */
async function fetchBusyBlocks(icsUrl: string, from: Date, to: Date): Promise<BusyBlock[]> {
  const events = await readFeed(icsUrl);
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
  // Two months, not a fortnight.
  //
  // Brad: "I want the agent to offer more dates, 2 months in advance it needs
  // to see." A customer asking about "next Saturday the 19th" was told it
  // wasn't showing as free when the real answer was that the agent could only
  // see fourteen days out — so a date the studio could genuinely have booked
  // read as unavailable. Half of a tattoo studio's enquiries are for
  // something weeks away; a fortnight's sight was the wrong shape for the
  // trade.
  const daysAhead = options?.daysAhead ?? 60;

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
 * Which DAYS have anything free, right across the horizon.
 *
 * `findFreeSlots` answers "when can you next fit me in" — it walks forward
 * and stops at the first few. That is the wrong question when a customer
 * names a date. A real one, from Brad's screenshot:
 *
 *   "Do you have an availability next Saturday 19th for me and Jake?"
 *
 * and the draft said the 19th "isn't showing as free for us yet" — because
 * the agent could only ever see the next handful of openings, all of them
 * that week. The 19th may well have been free; nothing had looked.
 *
 * So the prompt gets both: the soonest slots, and a plain list of every day
 * with something open between now and the horizon. One line, and it lets the
 * agent answer about a named date honestly instead of guessing from silence.
 */
export async function findFreeDays(daysAhead = 60): Promise<string[]> {
  const config = await getTimelyConfig().catch(() => undefined);
  if (!config?.calendarIcsUrl) return [];

  const now = new Date();
  const earliest = new Date(now.getTime() + MIN_NOTICE_MINUTES * 60_000);
  const horizon = new Date(now.getTime() + daysAhead * 24 * 60 * 60_000);

  let busy: BusyBlock[];
  try {
    busy = await fetchBusyBlocks(config.calendarIcsUrl, now, horizon);
  } catch (error) {
    // Same rule as everywhere else here: a calendar we cannot read must never
    // become invented availability.
    console.error("[Calendar] Couldn't read the feed for free days:", (error as Error).message);
    return [];
  }

  const days: string[] = [];

  for (let day = 0; day <= daysAhead; day++) {
    const { year, month, day: dayOfMonth, weekday } = studioDateParts(
      new Date(now.getTime() + day * 24 * 60 * 60_000)
    );
    if (CLOSED_WEEKDAYS.includes(weekday)) continue;

    const dayStart = studioTime(year, month, dayOfMonth, OPENING.startHour, OPENING.startMinute);
    const dayEnd = studioTime(year, month, dayOfMonth, OPENING.endHour, 0);

    for (
      let t = new Date(dayStart);
      t.getTime() + DEFAULT_SLOT_MINUTES * 60_000 <= dayEnd.getTime();
      t = new Date(t.getTime() + 30 * 60_000)
    ) {
      if (t < earliest) continue;
      const slotEnd = new Date(t.getTime() + DEFAULT_SLOT_MINUTES * 60_000);
      if (overlaps(t, slotEnd, busy)) continue;
      days.push(describeSlot(t));
      break;
    }
  }

  return days;
}

/* ------------------------------------------------------------------ */
/* Dates the customer names                                             */
/* ------------------------------------------------------------------ */

/*
 * Brad, 2 October, with a screenshot of Shae's card:
 *
 *   "Any availability for Saturday 12th December please?"
 *
 * and the draft: "December is a bit further out than what we've got loaded in
 * the books right now, so I'll check with Mim". Nothing was wrong with the
 * books — the agent's two-month window simply ended in early December, so the
 * 12th had never been looked at. His words: "it needs to look a couple months
 * into the calendar if requested by the customer".
 *
 * Widening the everyday list wouldn't do it: that list is every open day in
 * the window, it already made one thread's call time out when it grew, and a
 * customer naming a date in March would still fall off the end. So a date —
 * or a month — that the customer actually names is pulled out of their own
 * words and looked up on its own, up to six months ahead, for every sitting
 * length. The agent answers from that, or not at all.
 */

/** How far ahead a date the customer names is looked up. */
export const NAMED_DATE_DAYS = 183;

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function monthIndex(word: string | undefined): number | undefined {
  const w = (word ?? "").toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return undefined;
  if (w === "sept") return 8;
  const i = MONTH_NAMES.findIndex((name) => name.startsWith(w));
  return i >= 0 ? i : undefined;
}

function weekdayIndex(word: string | undefined): number | undefined {
  const w = (word ?? "").toLowerCase();
  if (w.length < 3) return undefined;
  const i = WEEKDAY_NAMES.findIndex((name) => name.startsWith(w.slice(0, 3)) && name.startsWith(w.replace(/s$/, "")));
  return i >= 0 ? i : undefined;
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Weekday of a civil date — no clock involved. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month, day)).getUTCDay();
}

export interface NamedDay {
  year: number;
  month: number;
  day: number;
}

export interface NamedMonth {
  year: number;
  month: number;
}

const WEEKDAY = "(mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+";
const NOT_A_SIZE = "(?!\\s*(?:cm|mm|am|pm|hrs?|hours?|mins?|minutes?|%|:|\\d))";
// "the 2nd one", "the 1st design" — an ordinal that is counting, not a date.
const NOT_AN_ORDINAL =
  "(?!\\s+(?:one|ones|design|piece|photo|pic|picture|image|option|session|sitting|tattoo|time|idea|drawing|draft|appointment|go|line|layer|coat|half|part)\\b)";

/**
 * Pull the dates out of what the customer wrote. Australian order — 12/12 is
 * the twelfth of December — and the next one coming, never one already gone:
 * "the 3rd of March" in October means next March.
 *
 * Deliberately conservative. A date it misses costs nothing (the agent says
 * it'll check, as before); a date it invents would put a real day's
 * availability in front of a customer who never asked. So: no "2.5", which is
 * a size; no bare "may", which is a verb; nothing relative ("next week" is
 * inside the everyday window anyway).
 */
export function datesNamedIn(texts: string[], now = new Date()): { days: NamedDay[]; months: NamedMonth[] } {
  const today = studioDateParts(now);
  const days: NamedDay[] = [];
  const months: NamedMonth[] = [];
  const seen = new Set<string>();

  const resolveYear = (month: number, day: number, year?: string): number | undefined => {
    if (year) {
      const y = Number(year.length === 2 ? `20${year}` : year);
      return y >= today.year && y <= today.year + 2 ? y : undefined;
    }
    const before = month < today.month || (month === today.month && day < today.day);
    return before ? today.year + 1 : today.year;
  };
  const addDay = (month: number | undefined, day: number, year?: string) => {
    if (month === undefined || month < 0 || month > 11 || day < 1) return;
    const y = resolveYear(month, day, year);
    if (y === undefined || day > daysIn(y, month)) return;
    const key = `${y}-${month}-${day}`;
    if (seen.has(key) || days.length >= 4) return;
    seen.add(key);
    days.push({ year: y, month, day });
  };

  for (const raw of texts) {
    // Spans already read are blanked out, so "Saturday 12th December" is one
    // date, not a date plus "the 12th" plus "December".
    // Only a span that WAS a date is blanked: "the 19th free" must stay
    // readable as "the 19th" after "19th free" fails as a day and a month.
    let text = ` ${raw ?? ""} `;
    const consume = (re: RegExp, read: (m: RegExpExecArray, before: string, after: string) => boolean | void) => {
      text = text.replace(re, (...args) => {
        const match = args.slice(0, -2) as unknown as RegExpExecArray;
        const offset = Number(args[args.length - 2]);
        const whole = String(args[args.length - 1]);
        const before = whole.slice(Math.max(0, offset - 30), offset);
        const after = whole.slice(offset + String(args[0]).length, offset + String(args[0]).length + 30);
        return read(match, before, after) ? " ".repeat(String(args[0]).length) : String(args[0]);
      });
    };

    // 12th December · Sat 12 Dec · the 12th of December 2026
    consume(
      new RegExp(`\\b(?:${WEEKDAY})?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+([a-z]{3,9})\\.?(?:,?\\s+(\\d{4}))?\\b`, "gi"),
      (m) => {
        const month = monthIndex(m[3]);
        // "we 2 may come in" — lower-case "may" is a verb.
        if (month === undefined || m[3] === "may") return false;
        addDay(month, Number(m[2]), m[4]);
        return true;
      }
    );
    // December 12th · Saturday, Dec 12 · December the 12th 2026
    consume(
      new RegExp(`\\b(?:${WEEKDAY})?([a-z]{3,9})\\.?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b${NOT_A_SIZE}(?:,?\\s+(\\d{4}))?`, "gi"),
      (m) => {
        const month = monthIndex(m[2]);
        if (month === undefined) return false;
        // "may 3" is a verb and a number; "May 3" is a date.
        if (/^may$/i.test(m[2]) && !/^M/.test(m[2])) return false;
        addDay(month, Number(m[3]), m[4]);
        return true;
      }
    );
    // 12/12 · 12/12/26 — day first. Slashes only: "2.5" is a size.
    // Without a year it has to read like a booking — "could I do 12/12",
    // "or 19/12" — because "8/10 for sure" is a rating, not the 8th of October.
    consume(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b(?!\s*(?:cm|mm))/g, (m, before, after) => {
      const booking = /\b(on|for|free|avail\w*|book\w*|come|do|fit|date|day|about|until|till|before|after|from|between|and|or)\b[^.?!]{0,20}$/i;
      const asking = /^\s*(\?|free|avail\w*|ok\b|okay|work|suit|possible|good for)/i;
      if (!m[3] && !booking.test(before) && !asking.test(after)) return false;
      addDay(Number(m[2]) - 1, Number(m[1]), m[3]);
      return true;
    });
    // Saturday the 19th · Sat 19th · the 19th — the next one, and if a
    // weekday came with it, the next one that IS that weekday.
    consume(
      new RegExp(`\\b(?:(mon|tue|wed|thu|fri|sat|sun)[a-z]*\\.?,?\\s+(?:the\\s+)?|the\\s+)(\\d{1,2})(st|nd|rd|th)?\\b${NOT_A_SIZE}${NOT_AN_ORDINAL}`, "gi"),
      (m) => {
        const dayNumber = Number(m[2]);
        const weekday = weekdayIndex(m[1]);
        if (!m[1] && !m[3]) return false; // "the 3 of us" is not a date
        if (dayNumber < 1 || dayNumber > 31) return false;
        let year = today.year;
        let month = today.month;
        if (dayNumber < today.day) {
          month += 1;
        }
        for (let tries = 0; tries < 14; tries++) {
          if (month > 11) {
            month -= 12;
            year += 1;
          }
          if (dayNumber <= daysIn(year, month) && (weekday === undefined || weekdayOf(year, month, dayNumber) === weekday)) {
            addDay(month, dayNumber, String(year));
            return true;
          }
          month += 1;
        }
        return false;
      }
    );
    // A month on its own — "anything in December?", "early Jan" — only after
    // a word that makes it a month. "Hi June" is a person; so is "Jan".
    consume(/\b(in|of|during|for|early|mid|late|around|until|before|after|about|this|next|over|through|start of|end of|beginning of)\s+([a-z]{3,9})\b/gi, (m) => {
      const month = monthIndex(m[2]);
      if (month === undefined) return false;
      const word = m[2].toLowerCase();
      if (!MONTH_NAMES[month].startsWith(word)) return false;
      if (word.length < 4 && !["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].includes(word)) return false;
      const year = month < today.month ? today.year + 1 : today.year;
      const key = `${year}-${month}`;
      if (seen.has(key) || months.length >= 2) return true;
      // A month that already has a named day in it is covered by that day.
      if (days.some((d) => d.year === year && d.month === month)) return true;
      seen.add(key);
      months.push({ year, month });
      return true;
    });
  }

  return { days, months };
}

function timeLabel(at: Date): string {
  return at
    .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TIMEZONE })
    .replace(":00", "")
    .replace(/\s/g, "")
    .toLowerCase();
}

function dayLabel(d: NamedDay, today: { year: number }): string {
  const weekday = WEEKDAY_NAMES[weekdayOf(d.year, d.month, d.day)];
  const month = MONTH_NAMES[d.month];
  const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
  return `${cap(weekday)} ${d.day} ${cap(month)}${d.year !== today.year ? ` ${d.year}` : ""}`;
}

/** The first start that fits each sitting length on one studio day. */
function openingsOn(d: NamedDay, busy: BusyBlock[], earliest: Date) {
  const dayStart = studioTime(d.year, d.month, d.day, OPENING.startHour, OPENING.startMinute);
  const dayEnd = studioTime(d.year, d.month, d.day, OPENING.endHour, 0);
  return SESSION_LENGTHS.map((length) => {
    for (
      let t = new Date(dayStart);
      t.getTime() + length.minutes * 60_000 <= dayEnd.getTime();
      t = new Date(t.getTime() + 30 * 60_000)
    ) {
      if (t < earliest) continue;
      if (overlaps(t, new Date(t.getTime() + length.minutes * 60_000), busy)) continue;
      return { key: length.key, start: t };
    }
    return { key: length.key, start: undefined as Date | undefined };
  });
}

/**
 * The dates and months the customer named, each looked up in the calendar,
 * one line apiece for the prompt. Empty when they named none, or when there
 * is no calendar to read — never a guess.
 */
export async function namedDatesForPrompt(texts: string[], now = new Date()): Promise<string> {
  const { days, months } = datesNamedIn(texts, now);
  if (!days.length && !months.length) return "";
  const config = await getTimelyConfig().catch(() => undefined);
  if (!config?.calendarIcsUrl) return "";

  const today = studioDateParts(now);
  const earliest = new Date(now.getTime() + MIN_NOTICE_MINUTES * 60_000);
  const horizon = new Date(now.getTime() + NAMED_DATE_DAYS * 86_400_000);
  let busy: BusyBlock[];
  try {
    // A day past the horizon too, so the last day checked is checked whole.
    busy = await fetchBusyBlocks(config.calendarIcsUrl, now, new Date(horizon.getTime() + 86_400_000));
  } catch (error) {
    console.error("[Calendar] Couldn't read the feed for a named date:", (error as Error).message);
    return "";
  }

  const lines: string[] = [];
  for (const d of days) {
    const label = dayLabel(d, today);
    const closesAt = studioTime(d.year, d.month, d.day, OPENING.endHour, 0);
    if (closesAt < now) continue;
    if (studioTime(d.year, d.month, d.day, 0, 0) > horizon) {
      lines.push(`- ${label}: more than six months out, so it hasn't been checked. Don't say it's free or booked.`);
      continue;
    }
    if (CLOSED_WEEKDAYS.includes(weekdayOf(d.year, d.month, d.day))) {
      const weekday = WEEKDAY_NAMES[weekdayOf(d.year, d.month, d.day)];
      lines.push(`- ${label}: the studio is closed on ${weekday[0].toUpperCase()}${weekday.slice(1)}s.`);
      continue;
    }
    const open = openingsOn(d, busy, earliest);
    const [short, half, full] = open;
    if (!short.start) {
      lines.push(`- ${label}: booked out, nothing free that day.`);
      continue;
    }
    const parts = [
      `short sitting from ${timeLabel(short.start)}`,
      half.start ? `half day from ${timeLabel(half.start)}` : "no half day",
      full.start ? "full day free" : "no full day",
    ];
    lines.push(`- ${label}: ${parts.join(", ")}.`);
  }

  for (const m of months) {
    const name = MONTH_NAMES[m.month][0].toUpperCase() + MONTH_NAMES[m.month].slice(1);
    const open: string[] = [];
    let checkedTo: number | undefined;
    for (let day = 1; day <= daysIn(m.year, m.month); day++) {
      const d = { year: m.year, month: m.month, day };
      if (studioTime(d.year, d.month, d.day, OPENING.endHour, 0) < now) continue;
      if (studioTime(d.year, d.month, d.day, 0, 0) > horizon) break;
      checkedTo = day;
      if (CLOSED_WEEKDAYS.includes(weekdayOf(d.year, d.month, d.day))) continue;
      const [short, , full] = openingsOn(d, busy, earliest);
      if (!short.start) continue;
      const weekday = WEEKDAY_NAMES[weekdayOf(d.year, d.month, d.day)].slice(0, 3);
      open.push(`${weekday[0].toUpperCase()}${weekday.slice(1)} ${day}${full.start ? " (full day)" : ""}`);
    }
    if (checkedTo === undefined) {
      lines.push(`- ${name}${m.year !== today.year ? ` ${m.year}` : ""}: more than six months out, so it hasn't been checked.`);
      continue;
    }
    const upTo = checkedTo < daysIn(m.year, m.month) ? ` (checked up to the ${checkedTo}th)` : "";
    lines.push(
      open.length
        ? `- ${name}${upTo}: something open on ${open.join(", ")}.`
        : `- ${name}${upTo}: booked out, nothing free.`
    );
  }

  return lines.join("\n");
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
export async function availabilityForPrompt(customerSaid: string[] = []): Promise<string> {
  const rows = await Promise.all(
    SESSION_LENGTHS.map(async (length) => {
      // Five rather than three: with two months in view the first three are
      // often all this week, which reads as "nothing else exists".
      const slots = await findFreeSlots({ slotMinutes: length.minutes, limit: 5 });
      return { ...length, slots };
    })
  );

  const freeDays = await findFreeDays().catch(() => []);
  const named = customerSaid.length ? await namedDatesForPrompt(customerSaid).catch(() => "") : "";

  if (rows.every((row) => row.slots.length === 0) && !freeDays.length && !named) return "";

  const soonest = rows
    .map(
      (row) =>
        `- ${row.label}: ${
          row.slots.length
            ? row.slots.map((s) => s.label).join(", ")
            : "nothing free in the next two months"
        }`
    )
    .join("\n");

  // The full two months, so a customer naming a date gets a real answer
  // rather than "that isn't showing as free" when nothing ever looked.
  const sections = [soonest];
  if (freeDays.length) {
    sections.push(
      `EVERY day with something open between now and two months out — if a customer names a date, check it against THIS list before saying it isn't free:\n${freeDays.join("; ")}`
    );
  }
  if (named) {
    sections.push(
      `THE DATES THIS CUSTOMER ASKED ABOUT, each looked up in the calendar just now (it is checked up to six months ahead). Answer about those dates from THESE lines, using the sitting this piece needs. Never tell them a date is "too far out" or "not in the books yet" when it's listed here:\n${named}`
    );
  }
  return sections.join("\n\n");
}

/**
 * Appointments that happened a given number of days ago.
 *
 * This is what makes the aftercare message possible. Brad: "after each
 * customer gets tattooed I want to automatically send them a message 3 days
 * later asking how their tattoo is".
 *
 * The calendar is the only record of who actually sat in the chair — the app
 * never sees the booking being made, only the conversation that led to it —
 * so a past appointment IS the signal, and the event title is the only name
 * we have to match a customer by.
 */
export async function getPastAppointments(daysAgo = 3): Promise<UpcomingBooking[]> {
  const config = await getTimelyConfig().catch(() => undefined);
  if (!config?.calendarIcsUrl) return [];

  const now = new Date();
  // A whole studio day, in Geelong's clock, N days back.
  const target = new Date(now.getTime() - daysAgo * 24 * 60 * 60_000);
  const { year, month, day } = studioDateParts(target);
  const from = studioTime(year, month, day, 0, 0);
  const to = studioTime(year, month, day, 23, 59);

  try {
    const blocks = await fetchBusyBlocks(config.calendarIcsUrl, from, to);
    return blocks
      .filter((b) => b.start >= from && b.start <= to)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((b) => ({
        title: b.title || "Appointment",
        start: b.start,
        label: describeSlot(b.start),
      }));
  } catch (error) {
    console.error("[Calendar] Couldn't read past appointments:", (error as Error).message);
    return [];
  }
}

export interface UpcomingBooking {
  title: string;
  start: Date;
  label: string;
}

export interface TodayBooking {
  title: string;
  start: Date;
  end: Date;
  /** Minutes past midnight on the studio's wall clock, clipped to today. */
  startMin: number;
  endMin: number;
}

export interface StudioToday {
  /** Whether a calendar link is saved at all — "nothing today" and "no calendar" read differently. */
  connected: boolean;
  /** The studio's wall clock when this was read, in minutes past midnight. */
  nowMin: number;
  bookings: TodayBooking[];
  /** The feed couldn't be read this time. */
  failed?: boolean;
}

/**
 * Today in the chair, on the studio's own clock: the appointments already
 * done as well as the ones still to come, which the upcoming list (future
 * only) can't give. The home screen's timeline draws straight from the
 * minute counts, so the browser never has to know which timezone Geelong is
 * in — the same trap `offsetMs` exists for.
 */
export async function getTodayBookings(): Promise<StudioToday> {
  const now = new Date();
  const nowMin = studioMinutesOfDay(now);
  const config = await getTimelyConfig().catch(() => undefined);
  if (!config?.calendarIcsUrl) return { connected: false, nowMin, bookings: [] };

  const { year, month, day } = studioDateParts(now);
  const from = studioTime(year, month, day, 0, 0);
  const to = studioTime(year, month, day + 1, 0, 0);

  try {
    const blocks = await fetchBusyBlocks(config.calendarIcsUrl, from, to);
    const bookings = blocks
      .filter((b) => b.end > from && b.start < to)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(0, 12)
      .map((b) => ({
        title: b.title || "Appointment",
        start: b.start,
        end: b.end,
        startMin: b.start <= from ? 0 : studioMinutesOfDay(b.start),
        endMin: b.end >= to ? 24 * 60 : studioMinutesOfDay(b.end),
      }));
    return { connected: true, nowMin, bookings };
  } catch (error) {
    console.error("[Calendar] Couldn't read today's bookings:", (error as Error).message);
    return { connected: true, nowMin, bookings: [], failed: true };
  }
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
