import { useEffect, useRef } from "react";

/**
 * Fades sections in as they scroll into view.
 *
 * The `.reveal` class (which hides the element) is added here rather than in
 * the markup, so if scripting is unavailable the content just renders
 * normally instead of staying invisible forever. Anyone who has asked for
 * reduced motion is skipped entirely.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || typeof IntersectionObserver === "undefined") return;

    node.classList.add("reveal");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return ref;
}
