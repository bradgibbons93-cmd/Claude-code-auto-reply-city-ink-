import { Link } from "wouter";
import {
  Zap,
  ImageIcon,
  Images,
  BarChart3,
  Star,
  CalendarCheck,
  Sparkles,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Everything the studio does, one tap from home.
 *
 * Brad sent a layout he liked and this is the half of it worth taking: a grid
 * of tiles under the greeting, so every part of the app is reachable without
 * opening a menu. On a phone — which is where he actually works — the sidebar
 * lives behind a hamburger, so a section he doesn't use weekly may as well not
 * exist. Eight tiles, two rows, thumb-sized.
 *
 * The palette stays the studio's own. The layout he showed me was gold on
 * black, which is a good-looking mockup of somebody else's brand; coffee
 * brown and silver are on the sheet he sent months ago, they're on the sign
 * above the door, and this file has a rule about not introducing a third
 * colour the studio doesn't own.
 */

interface Tile {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const TILES: Tile[] = [
  { href: "/rules", label: "Auto-replies", hint: "Instant answers", icon: Zap },
  { href: "/posts", label: "Content & posting", hint: "Schedule photos", icon: ImageIcon },
  { href: "/gallery", label: "Artist uploads", hint: "The studio's work", icon: Images },
  { href: "/analytics", label: "Analytics", hint: "How it's going", icon: BarChart3 },
  { href: "/checkins", label: "Follow-ups", hint: "Aftercare & reviews", icon: Star },
  { href: "/bookings", label: "Bookings", hint: "What's coming up", icon: CalendarCheck },
  { href: "/training", label: "AI training", hint: "Teach it your voice", icon: Sparkles },
  { href: "/settings", label: "Settings", hint: "Connections & keys", icon: SettingsIcon },
];

export default function StudioTiles({ className }: { className?: string }) {
  return (
    <nav aria-label="Studio sections" className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
      {TILES.map(({ href, label, hint, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "group flex flex-col gap-2 rounded-2xl border border-border bg-card p-4",
            "shadow-soft transition-all duration-200",
            "hover:-translate-y-0.5 hover:border-sepia/45 hover:shadow-lift",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          )}
        >
          <span
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl",
              "bg-beige/40 text-primary transition-colors group-hover:bg-beige/70"
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-charcoal">{label}</span>
            {/* What the section is for, in the studio's words rather than the
                app's. "Aftercare & reviews" says more than "Check-ins". */}
            <span className="block truncate text-[0.7rem] text-muted-foreground">{hint}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
