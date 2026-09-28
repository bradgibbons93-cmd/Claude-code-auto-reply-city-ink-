import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Whether the studio has taken a thread over by hand.
 *
 * Only a `manual` pause reaches the client as a future `botPausedUntil` —
 * the automatic handoff pause is lifted server-side the moment the customer
 * speaks again, which is the whole point of it.
 */
export function isPaused(until: string | Date | null | undefined) {
  return !!until && new Date(until) > new Date();
}

/**
 * "Nobody has answered this yet" — the one question Brad works the inbox by,
 * and it must mean the same thing on every screen that asks it.
 *
 * It lived in Conversations.tsx while the dashboard listed threads with no
 * test at all, so the home screen showed people who had already been replied
 * to, sitting under a heading that implied they hadn't. Same shape as
 * `getPendingReplies` and `getUnansweredConversations` disagreeing on the
 * server: two readers of one fact, one of them wrong.
 *
 * `lastSenderType` is worked out server-side by when a message was SAID,
 * never by row id.
 */
export function isUnanswered(c: {
  lastSenderType?: string | null;
  botPausedUntil?: string | Date | null;
  lastMessageAt?: string | Date | null;
}) {
  return !isPaused(c.botPausedUntil) && awaitsStudio(c);
}

/**
 * How long after a customer's last message Meta lets the app answer them.
 * Must match `REPLY_WINDOW_DAYS` in server/db.ts.
 */
export const REPLY_WINDOW_DAYS = 7;

/**
 * The customer spoke last, recently enough that they can still be answered.
 *
 * The top section of the inbox. Brad: "Always remove messages that have been
 * replied to already." Past Meta's seven days nothing here can reply to
 * them, and those threads have nearly always been answered by hand somewhere
 * this app never saw — so they drop to Replied instead of sitting on top of
 * the people who can still be helped.
 *
 * Unlike `isUnanswered`, a thread Brad has taken over still counts: it still
 * needs a reply, it's just his to write.
 */
export function awaitsStudio(c: {
  lastSenderType?: string | null;
  lastMessageAt?: string | Date | null;
}) {
  if (c.lastSenderType !== "customer") return false;
  if (!c.lastMessageAt) return true;
  return Date.now() - new Date(c.lastMessageAt).getTime() < REPLY_WINDOW_DAYS * 24 * 3600 * 1000;
}

/**
 * Meta's short clock: "11m", "7h", "1d", "3w". The inbox list is scanned,
 * not read, and "about 7 hours ago" is four words where one will do.
 */
export function shortAgo(at: string | Date | null | undefined, now = Date.now()) {
  if (!at) return "";
  const minutes = Math.max(0, Math.floor((now - new Date(at).getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52) return `${weeks}w`;
  return `${Math.floor(days / 365)}y`;
}

/**
 * The line under a name in the inbox, the way Meta writes it: the message
 * itself, or "LIV sent 2 photos." when there's no text, with "You: " in front
 * when the studio spoke last.
 */
export function previewLine(c: {
  senderName?: string | null;
  lastSenderType?: string | null;
  lastPreview?: string | null;
  lastPhotoCount?: number | null;
}) {
  const ours = !!c.lastSenderType && c.lastSenderType !== "customer";
  const first = (c.senderName || "").trim().split(/\s+/)[0] || "They";
  const photos = c.lastPhotoCount ?? 0;
  const raw = (c.lastPreview ?? "").trim();
  // The app stores a photo-only message as "(sent a photo)" so it's never
  // blank. Meta says it in the sender's name.
  const text = /^\(sent (a|\d+) photos?\)$|^\(attachment\)$/i.test(raw) ? "" : raw;
  if (!text && photos) {
    const what = photos === 1 ? "a photo" : `${photos} photos`;
    return ours ? `You sent ${what}.` : `${first} sent ${what}.`;
  }
  if (!text) return ours ? "You sent an attachment." : `${first} sent an attachment.`;
  return ours ? `You: ${text}` : text;
}
