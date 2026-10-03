import { useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Opening a photo without leaving the app.
 *
 * Brad: "when I click on a photo either the ones uploaded by artists or the
 * customer pictures, there is no back button and I have to cancel the app."
 *
 * Every photo in this app was an `<a target="_blank">`. In a browser that
 * opens a tab you can close. On the HOME SCREEN — which is where Brad works,
 * and which the push notifications require — the app runs standalone with no
 * address bar, no tabs and no back button, so a photo opened over the top of
 * everything with no way out. Force-quitting the app was genuinely the only
 * exit, and it took him back to the dashboard rather than the thread he was
 * reading.
 *
 * So the photo opens INSIDE the app instead, and there are four ways out,
 * because the one thing this must never do again is trap him:
 *
 *   - the close button, big enough for a thumb and clear of the notch
 *   - tapping the backdrop
 *   - Escape, on a laptop
 *   - the phone's own back gesture — `history.pushState` puts an entry on
 *     the stack so back closes the picture instead of leaving the app, which
 *     is the gesture he'd reach for first after being stuck
 *
 * Several photos is the normal case, not the edge case: this file already
 * notes that four reference photos is one enquiry. So the arrows step
 * through the set rather than making him close and reopen each one.
 */
export default function PhotoViewer({
  urls,
  index,
  onClose,
  onIndex,
  alt = "Photo",
}: {
  urls: string[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
  alt?: string;
}) {
  const many = urls.length > 1;
  const go = useCallback(
    (delta: number) => onIndex((index + delta + urls.length) % urls.length),
    [index, urls.length, onIndex]
  );

  /*
   * The phone's back gesture should close the picture, not the app. One
   * history entry on open means back fires popstate and we close, instead of
   * navigating off the thread he was reading.
   *
   * Two things here are load-bearing and I got both wrong first time, in a
   * way that was WORSE than the bug being fixed — back took him out of the
   * app completely:
   *
   *   - The effect must run on mount and unmount only. `onClose` is an inline
   *     arrow at every call site, so a new function identity on every render;
   *     with it in the dependencies this pushed a fresh history entry each
   *     render until back did nothing at all. The callback lives in a ref
   *     instead, and the dependency list is empty.
   *   - Cleanup must only pop OUR entry when the back gesture has not already
   *     popped it. Calling back() unconditionally after a real back press
   *     consumed a second entry and left the app.
   */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let poppedByBack = false;
    window.history.pushState({ photoViewer: true }, "");
    const pop = () => {
      poppedByBack = true;
      closeRef.current();
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      if (!poppedByBack) window.history.back();
    };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (many && e.key === "ArrowRight") go(1);
      if (many && e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    // Stop the page behind scrolling under the photo.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = previous;
    };
  }, [onClose, go, many]);

  /*
   * Rendered into <body>, not where it is written.
   *
   * The first version rendered in place and the close button came out UNDERNEATH
   * the header — the one control that had to work. `position: fixed` resolves
   * against the nearest ancestor with a transform rather than the viewport, and
   * these photos sit inside cards carrying `animate-fade-up`, which is a
   * transform. So `fixed inset-0 z-50` was pinned inside a card and trapped in
   * its stacking context, below a `z-20` header.
   *
   * A portal to <body> has no such ancestor, so the overlay covers the page
   * whatever it was opened from. Worth remembering: Playwright's isVisible()
   * called it visible the whole time, because being covered by another element
   * is not the same as being hidden. The screenshot is what caught it.
   */
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      // The backdrop closes it. Deliberately the whole area, because after
      // being trapped once the instinct is to tap anywhere but the picture.
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/95 p-4 animate-fade-up"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        // Below the notch on an iPhone, and thumb-sized. This is the control
        // that was missing, so it is the most obvious thing on the screen.
        className={cn(
          "fixed right-4 top-[max(1rem,env(safe-area-inset-top))] z-10",
          "flex h-12 w-12 items-center justify-center rounded-full",
          "bg-card/95 text-charcoal shadow-lift transition-transform",
          "hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        )}
      >
        <X className="h-6 w-6" aria-hidden="true" />
      </button>

      {many && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="fixed left-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-card/85 text-charcoal shadow-lift"
          >
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="fixed right-3 top-1/2 z-10 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-card/85 text-charcoal shadow-lift"
          >
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </button>
          <p className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-full bg-card/85 px-3 py-1 text-xs text-charcoal">
            {index + 1} of {urls.length}
          </p>
        </>
      )}

      <img
        src={urls[index]}
        alt={alt}
        // Clicking the picture itself must NOT close it — that makes pinching
        // and panning a photo feel broken.
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>,
    document.body
  );
}
