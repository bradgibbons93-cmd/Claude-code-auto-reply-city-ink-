import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScrolled } from "./motion";
import { Emblem, GoldLink, Wordmark } from "./primitives";

export const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#studios", label: "Studios" },
];

/**
 * Fixed rather than sticky: the landing root clips horizontal overflow, which
 * would make it the scroll container a sticky header pins to — and it never
 * scrolls. Transparent over the hero, glass once the page moves.
 */
export function LandingNav() {
  const scrolled = useScrolled(8);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onResize = () => window.innerWidth >= 768 && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div
        className={cn(
          "border-b transition-[background-color,border-color,backdrop-filter] duration-300",
          open
            ? "border-white/[0.08] bg-[#07070A]/[0.97] backdrop-blur-xl"
            : scrolled
              ? "border-white/[0.08] bg-[#07070A]/75 backdrop-blur-xl backdrop-saturate-150"
              : "border-transparent bg-transparent"
        )}
      >
        <nav aria-label="Main" className="mx-auto flex h-16 max-w-[1200px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex min-h-[44px] items-center gap-2.5 rounded-lg" onClick={() => setOpen(false)}>
            <Emblem className="h-[26px] w-[28px]" />
            <Wordmark className="h-[15px] sm:h-[17px]" />
          </a>

          <ul className="ml-8 hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="inline-flex h-11 items-center rounded-full px-3.5 text-[14px] font-medium text-[#A6A09A] transition-colors hover:text-[#F4F1EA]"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Link
              href="/login"
              className="hidden h-11 items-center rounded-full px-3.5 text-[14px] font-medium text-[#D8D2C9] transition-colors hover:text-white sm:inline-flex"
            >
              Log in
            </Link>
            <GoldLink href="/signup" size="sm" className="px-4 sm:px-5">
              Get started
            </GoldLink>
            <button
              type="button"
              aria-expanded={open}
              aria-controls="rn-mobile-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
              className="-mr-1.5 grid h-11 w-11 place-items-center rounded-full text-[#F4F1EA] transition-colors hover:bg-white/[0.06] md:hidden"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </nav>

        <div
          id="rn-mobile-menu"
          hidden={!open}
          className="border-t border-white/[0.06] md:hidden"
        >
          <ul className="mx-auto max-w-[1200px] px-4 py-2 sm:px-6">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex h-12 items-center border-b border-white/[0.05] text-[16px] font-medium text-[#F4F1EA]"
                >
                  {l.label}
                </a>
              </li>
            ))}
            <li className="pb-2 pt-3">
              <Link
                href="/login"
                className="rn-btn-ghost flex h-12 items-center justify-center rounded-full text-[16px] font-medium text-[#F4F1EA]"
              >
                Log in
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </header>
  );
}
