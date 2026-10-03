import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Motion for the Runnit landing page.
 *
 * Everything here is scoped to the page: keyframes and helper classes are
 * prefixed `rn-` and rendered from <LandingStyles/>, so nothing leaks into the
 * studio dashboard and no global stylesheet has to change. With
 * `prefers-reduced-motion: reduce` every animation and reveal is switched off
 * and content is simply shown.
 */

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** True once the element has scrolled into view. Fires once, then stops watching. */
export function useReveal<T extends Element>(rootMargin = "0px 0px -8% 0px") {
  const ref = useRef<T | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined" || prefersReducedMotion()) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return [ref, shown] as const;
}

/** Fades and lifts its children in when they enter the viewport. */
export function Reveal({
  children,
  className,
  delay = 0,
  style,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  style?: CSSProperties;
}) {
  const [ref, shown] = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cn("rn-reveal", shown && "rn-in", className)}
      style={{ ...style, ["--rn-delay" as string]: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/** Whether the page has scrolled past `offset` pixels — drives the glass nav. */
export function useScrolled(offset = 8) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > offset);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [offset]);
  return scrolled;
}

/**
 * Paints the browser chrome to match while the landing page is mounted — the
 * iPhone status bar and the overscroll area would otherwise show the
 * dashboard's silver — and puts it back on the way out.
 */
export function useLandingChrome() {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previous = meta?.getAttribute("content") ?? null;
    meta?.setAttribute("content", "#07070A");
    return () => {
      if (meta && previous !== null) meta.setAttribute("content", previous);
    };
  }, []);
}

const CSS = String.raw`
html:has(.rn-root){background-color:#07070A}
body:has(.rn-root){background-color:#07070A!important;background-image:none!important}
body:has(.rn-root)::before{display:none}
@media (prefers-reduced-motion:no-preference){html:has(.rn-root){scroll-behavior:smooth}}

.rn-root{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
.rn-root :focus-visible{outline:2px solid #F6D58E;outline-offset:3px}
.rn-root ::selection{background:rgba(217,169,78,.35);color:#fff}

.rn-gold-text{background:linear-gradient(100deg,#F6D58E 0%,#EDC77C 30%,#D9A94E 58%,#B7823A 82%,#E8C27A 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
.rn-gold-fill{background:linear-gradient(180deg,#F8DB98 0%,#E7BD6B 42%,#D9A94E 62%,#B07833 100%)}
.rn-gold-line{background:linear-gradient(90deg,transparent,rgba(217,169,78,.55),transparent)}
.rn-hairline{background:linear-gradient(90deg,transparent,rgba(255,255,255,.10),transparent)}

.rn-card{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.012) 60%);border:1px solid rgba(255,255,255,.08);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 24px 48px -32px rgba(0,0,0,.8)}
.rn-inset{background:#0C0C10;border:1px solid rgba(255,255,255,.07);box-shadow:inset 0 1px 0 rgba(255,255,255,.03)}
@media (max-width:639.98px){.rn-card-xs{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.012) 60%);border:1px solid rgba(255,255,255,.08);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 24px 48px -32px rgba(0,0,0,.8)}}
@media (min-width:640px){.rn-card-sm{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.012) 60%);border:1px solid rgba(255,255,255,.08);box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 24px 48px -32px rgba(0,0,0,.8)}}

.rn-btn-gold{position:relative;isolation:isolate;overflow:hidden;color:#1A1206;background:linear-gradient(180deg,#F8DB98 0%,#E7BD6B 42%,#D9A94E 62%,#B8813A 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(90,55,15,.35),0 10px 30px -12px rgba(217,169,78,.65),0 0 0 1px rgba(154,100,36,.55);transition:transform .25s cubic-bezier(.22,1,.36,1),box-shadow .25s,filter .25s}
.rn-btn-gold::after{content:"";position:absolute;top:0;bottom:0;left:0;width:40%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:translateX(-160%) skewX(-18deg);animation:rn-sweep 6s cubic-bezier(.45,0,.2,1) infinite 1.2s;pointer-events:none;z-index:-1}
.rn-btn-ghost{background:rgba(255,255,255,.03);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);transition:background-color .25s,box-shadow .25s,transform .25s cubic-bezier(.22,1,.36,1)}
@media (hover:hover){
  .rn-btn-gold:hover{transform:translateY(-1px);filter:brightness(1.05);box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 0 -1px 0 rgba(90,55,15,.35),0 16px 40px -12px rgba(217,169,78,.75),0 0 0 1px rgba(154,100,36,.6)}
  .rn-btn-ghost:hover{background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.24)}
  .rn-lift{transition:transform .45s cubic-bezier(.22,1,.36,1),border-color .45s,box-shadow .45s}
  .rn-lift:hover{transform:translateY(-4px);border-color:rgba(217,169,78,.26);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 30px 60px -30px rgba(0,0,0,.9),0 0 0 1px rgba(217,169,78,.06),0 20px 80px -40px rgba(217,169,78,.28)}
}
.rn-btn-gold:active,.rn-btn-ghost:active{transform:translateY(0) scale(.985)}

.rn-reveal{opacity:0;transform:translate3d(0,22px,0);transition:opacity .9s cubic-bezier(.22,1,.36,1),transform .9s cubic-bezier(.22,1,.36,1);transition-delay:var(--rn-delay,0ms)}
.rn-reveal.rn-in{opacity:1;transform:none}

@keyframes rn-sweep{0%{transform:translateX(-160%) skewX(-18deg)}45%,100%{transform:translateX(330%) skewX(-18deg)}}
@keyframes rn-float{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-10px,0)}}
@keyframes rn-float-alt{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,8px,0)}}
@keyframes rn-spin{to{transform:rotate(360deg)}}
@keyframes rn-ping{0%{transform:scale(1);opacity:.7}80%,100%{transform:scale(2.4);opacity:0}}
@keyframes rn-sheen{0%{background-position:160% 0}50%,100%{background-position:-60% 0}}
@keyframes rn-glow{0%,100%{box-shadow:0 0 0 0 rgba(217,169,78,0)}50%{box-shadow:0 0 0 6px rgba(217,169,78,.12)}}
@keyframes rn-caret{0%,100%{opacity:1}50%{opacity:0}}

.rn-float{animation:rn-float 8s ease-in-out infinite}
.rn-float-alt{animation:rn-float-alt 9s ease-in-out infinite}
.rn-spin-slow{animation:rn-spin 120s linear infinite}
.rn-ping{animation:rn-ping 2.4s cubic-bezier(0,0,.2,1) infinite}
.rn-glow{animation:rn-glow 3.2s ease-in-out infinite}
.rn-caret{animation:rn-caret 1.1s steps(1) infinite}

/* A gold light that passes over the emblem only — masked to its own pixels. */
.rn-emblem-sheen{position:absolute;inset:0;-webkit-mask:url(/brand/runnit-emblem.png) center/contain no-repeat;mask:url(/brand/runnit-emblem.png) center/contain no-repeat;background:linear-gradient(105deg,transparent 35%,rgba(255,246,220,.95) 50%,transparent 65%);background-size:250% 100%;mix-blend-mode:screen;animation:rn-sheen 5.5s ease-in-out infinite 1s;pointer-events:none}

.rn-grid-bg{background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000 20%,transparent 75%);mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000 20%,transparent 75%)}

@media (prefers-reduced-motion:reduce){
  .rn-reveal{opacity:1!important;transform:none!important;transition:none!important}
  .rn-float,.rn-float-alt,.rn-spin-slow,.rn-ping,.rn-glow,.rn-caret,.rn-emblem-sheen,.rn-btn-gold::after{animation:none!important}
  .rn-emblem-sheen{display:none}
  .rn-lift,.rn-btn-gold,.rn-btn-ghost{transition:none!important}
}
`;

/** The page's scoped stylesheet. Render once, inside the landing root. */
export function LandingStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
