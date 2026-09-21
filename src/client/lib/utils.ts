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
}) {
  return !isPaused(c.botPausedUntil) && c.lastSenderType === "customer";
}
