import { useEffect, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  MessageSquare,
  Zap,
  Calendar,
  BrainCircuit,
  Settings as SettingsIcon,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import Conversations from "./pages/Conversations";
import AutoReplyRules from "./pages/AutoReplyRules";
import PostScheduler from "./pages/PostScheduler";
import Training from "./pages/Training";
import Settings from "./pages/Settings";

const NAV = [
  { href: "/", label: "Messages", icon: MessageSquare },
  { href: "/training", label: "Training", icon: BrainCircuit },
  { href: "/rules", label: "Auto-replies", icon: Zap },
  { href: "/posts", label: "Posts", icon: Calendar },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

/** The stacked wordmark from the brand book. */
function Wordmark() {
  return (
    <div className="px-6 py-7">
      <p className="font-display text-[1.35rem] leading-none tracking-[0.34em] text-charcoal">
        CITY INK
      </p>
      <p className="mt-2 text-[0.6rem] uppercase tracking-[0.38em] text-muted-foreground">
        Tattoo Geelong
      </p>
      <div className="mt-5 h-px w-10 bg-beige" />
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  // Badge the Messages item so a waiting draft is visible from any page.
  const { data: pending } = trpc.pendingReplies.list.useQuery(undefined, {
    refetchInterval: 10000,
  });

  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = location === href;
        const badge = href === "/" ? pending?.length ?? 0 : 0;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-300",
              active
                ? "bg-beige/30 text-charcoal shadow-soft"
                : "text-muted-foreground hover:bg-beige/15 hover:text-charcoal"
            )}
          >
            <Icon
              className={cn(
                "h-4 w-4 transition-transform duration-300 group-hover:scale-110",
                active ? "text-sepia" : ""
              )}
            />
            <span className="flex-1">{label}</span>
            {badge > 0 && (
              <span className="animate-glow-pulse rounded-full bg-sepia px-2 py-0.5 text-[0.65rem] font-medium text-white">
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** Sits at the bottom of the page confirming the thing is actually alive. */
function StatusBar() {
  const [now, setNow] = useState(() => new Date());
  const { data: health } = trpc.stats.useQuery(undefined, { refetchInterval: 15000 });

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center pb-4">
      <div className="glass pointer-events-auto flex items-center gap-4 rounded-full px-5 py-2 text-xs text-muted-foreground shadow-soft">
        <span className="flex items-center gap-2">
          <span className="live-dot" />
          <span className="text-charcoal">System live</span>
        </span>
        <span className="hidden sm:inline">
          {health ? `${health.conversations} threads` : "connecting…"}
        </span>
        <span className="hidden tabular-nums sm:inline">
          {now.toLocaleTimeString("en-AU", { hour12: false })}
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();
  const current = NAV.find((n) => n.href === location);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => setMenuOpen(false), [location]);

  return (
    <div className="min-h-screen text-foreground">
      {/* Desktop sidebar */}
      <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r lg:flex">
        <Wordmark />
        <NavLinks />
        <div className="mt-auto px-6 py-6">
          <p className="text-[0.6rem] uppercase tracking-[0.3em] text-muted-foreground">
            Create. Express.
          </p>
          <p className="text-[0.6rem] uppercase tracking-[0.3em] text-muted-foreground">
            Wear your story.
          </p>
        </div>
      </aside>

      {/* Mobile drawer */}
      {menuOpen && (
        <>
          <button
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-30 bg-charcoal/20 backdrop-blur-sm lg:hidden"
          />
          <aside className="glass fixed inset-y-0 left-0 z-40 flex w-64 animate-fade-up flex-col lg:hidden">
            <Wordmark />
            <NavLinks onNavigate={() => setMenuOpen(false)} />
          </aside>
        </>
      )}

      <div className="lg:pl-60">
        <header className="glass sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-4 md:px-8">
          <button
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-lg p-2 text-charcoal transition-colors hover:bg-beige/25 lg:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg tracking-[0.12em] text-charcoal">
              {current?.label ?? "Front of House"}
            </h1>
          </div>

          <span className="hidden items-center gap-2 rounded-full border border-beige/60 bg-beige/15 px-3 py-1.5 text-xs text-charcoal sm:flex">
            <span className="live-dot" />
            Automation active
          </span>
        </header>

        <main className="mx-auto max-w-6xl animate-fade-up px-4 pb-24 pt-8 md:px-8">
          <Switch>
            <Route path="/" component={Conversations} />
            <Route path="/training" component={Training} />
            <Route path="/rules" component={AutoReplyRules} />
            <Route path="/posts" component={PostScheduler} />
            <Route path="/settings" component={Settings} />
            <Route>
              <p className="text-muted-foreground">That page doesn't exist.</p>
            </Route>
          </Switch>
        </main>
      </div>

      <StatusBar />
    </div>
  );
}
