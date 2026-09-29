import { useSyncExternalStore } from "react";

/**
 * Replies swiped away on the home screen, waiting out their undo window.
 *
 * A swipe is an approval, and a swipe can be an accident — a thumb dragging
 * the page sideways on a bus. So nothing goes to Meta for a few seconds: the
 * card leaves, a toast offers Undo, and only then does the approve call run.
 *
 * This lives at module level on purpose. Tied to the component, leaving the
 * home screen inside the window would have cancelled the send without a word
 * — the studio saw the card go and the customer never heard back. Out here a
 * swipe survives navigation; only closing the app drops it, and then the
 * draft is simply still on the board next time.
 *
 * A draft stays hidden until its send has finished and the board has been
 * re-read, so it can't flicker back onto the deck in between.
 */

type Entry = { timer: ReturnType<typeof setTimeout> | null };

const entries = new Map<number, Entry>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<number> = new Set();

function emit() {
  snapshot = new Set(entries.keys());
  listeners.forEach((listener) => listener());
}

export function queueSend(id: number, delayMs: number, send: () => Promise<unknown>) {
  if (entries.has(id)) return;
  const entry: Entry = { timer: null };
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void send().finally(() => {
      entries.delete(id);
      emit();
    });
  }, delayMs);
  entries.set(id, entry);
  emit();
}

/** Undo. True when it was still waiting — false once it has gone to Meta. */
export function cancelSend(id: number): boolean {
  const entry = entries.get(id);
  if (!entry?.timer) return false;
  clearTimeout(entry.timer);
  entries.delete(id);
  emit();
  return true;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Draft ids that have been swiped and are waiting or sending. */
export function useQueuedSends(): ReadonlySet<number> {
  return useSyncExternalStore(subscribe, () => snapshot);
}
