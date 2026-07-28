import { useEffect, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  LayoutGrid,
  MessageSquare,
  CalendarCheck,
  CheckCircle2,
  BarChart3,
  ImageIcon,
  Sparkles,
  Zap,
  Settings as SettingsIcon,
  Menu,
  X,
  Moon,
  Sun,
  Bell,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useTheme } from "@/lib/useTheme";
import { Monogram } from "@/components/Logo";
import Dashboard from "./pages/Dashboard";
import Conversations from "./pages/Conversations";
import Bookings from "./pages/Bookings";
import CheckIns from "./pages/CheckIns";
import Analytics from "./pages/Analytics";
import AutoReplyRules from "./pages/AutoReplyRules";
import PostScheduler from "./pages/PostScheduler";
import Training from "./pages/Training";
import Settings from "./pages/Settings";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutGrid, badge: false },
  { href: "/messages", label: "Messages", icon: MessageSquare, badge: true },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck, badge: false },
  { href: "/checkins", label: "Check-ins", icon: CheckCircle2, badge: false },
  { href: "/analytics", label: "Analytics", icon: BarChart3, badge: false },
  { href: "/posts", label: "Content", icon: ImageIcon, badge: false },
  { href: "/training", label: "AI Training", icon: Sparkles, badge: false },
  { href: "/rules", label: "Auto-replies", icon: Zap, badge: false },
  { href: "/settings", label: "Settings", icon: SettingsIcon, badge: false },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const { data: pending } = trpc.pendingReplies.list.useQuery(undefined, {
    refetchInterval: 10000,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="px-7 pb-6 pt-8">
        <p className="font-display text-[1.25rem] leading-none tracking-[0.3em] text-charcoal">
          CITY INK
        </p>
        <p className="mt-2 text-[0.55rem] uppercase tracking-[0.4em] text-muted-foreground">
          Tattoo Geelong
        </p>
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map(({ href, label, icon: Icon, badge }) => {
          const active = location === href;
          const count = badge ? pending?.length ?? 0 : 0;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm transition-all duration-300",
                active
                  ? "bg-beige/35 text-charcoal shadow-soft"
                  : "text-muted-foreground hover:bg-beige/15 hover:text-charcoal"
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110",
                  active && "text-sepia"
                )}
              />
              <span className="flex-1 truncate">{label}</span>
              {count > 0 && (
                <span className="animate-glow-pulse rounded-full bg-primary px-2 py-0.5 text-[0.62rem] font-medium text-primary-foreground">
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col items-center px-6 pb-8 pt-10">
        <Monogram className="h-16 w-12 text-sepia" />
        <p className="mt-5 text-center text-[0.55rem] uppercase tracking-[0.28em] text-muted-foreground">
          Create. Express.
        </p>
        <p className="text-center text-[0.55rem] uppercase tracking-[0.28em] text-muted-foreground">
          Wear your story.
        </p>
      </div>
    </div>
  );
}

function StatusBar() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center pb-4">
      <div className="glass pointer-events-auto flex items-center gap-4 rounded-full border px-5 py-2 text-xs text-muted-foreground shadow-soft">
        <span className="flex items-center gap-2">
          <span className="live-dot" />
          <span className="text-charcoal">System live &amp; running</span>
        </span>
        <span className="hidden tabular-nums sm:inline">
          Last updated {now.toLocaleTimeString("en-AU", { hour12: false })}
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const [location] = useLocation();
  const { data: pending } = trpc.pendingReplies.list.useQuery(undefined, {
    refetchInterval: 10000,
  });

  useEffect(() => setMenuOpen(false), [location]);

  return (
    <div className="min-h-screen text-foreground">
      <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-60 overflow-y-auto border-r lg:block">
        <Sidebar />
      </aside>

      {menuOpen && (
        <>
          <button
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-30 bg-background/60 backdrop-blur-sm lg:hidden"
          />
          <aside className="glass fixed inset-y-0 left-0 z-40 w-64 animate-fade-up overflow-y-auto border-r lg:hidden">
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </aside>
        </>
      )}

      <div className="lg:pl-60">
        <header className="glass sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-3 md:px-6">
          <button
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-lg p-2 text-charcoal transition-colors hover:bg-beige/25 lg:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <label className="relative hidden min-w-0 flex-1 items-center md:flex lg:max-w-md">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              placeholder="Search anything…"
              className="h-10 w-full rounded-xl border border-border bg-input pl-9 pr-3 text-sm transition-all duration-300 placeholder:text-muted-foreground focus:border-sepia/60 focus:shadow-glow focus:outline-none"
            />
          </label>

          <div className="flex-1 md:hidden" />

          <span className="hidden items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-xs sm:flex">
            <span className="live-dot" />
            <span className="text-charcoal">Live</span>
          </span>

          <Link
            href="/messages"
            className="relative rounded-full border border-border p-2 text-charcoal transition-all duration-300 hover:border-sepia hover:shadow-glow"
            aria-label={`${pending?.length ?? 0} drafts waiting for approval`}
          >
            <Bell className="h-4 w-4" />
            {!!pending?.length && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.6rem] font-medium text-primary-foreground">
                {pending.length}
              </span>
            )}
          </Link>

          <button
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            className="rounded-full border border-border p-2 text-charcoal transition-all duration-300 hover:border-sepia hover:shadow-glow"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <div className="flex items-center gap-2.5 rounded-xl border border-border py-1.5 pl-1.5 pr-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-beige/40 text-[0.65rem] font-medium text-charcoal">
              BG
            </span>
            <span className="hidden leading-tight sm:block">
              <span className="block text-xs text-charcoal">Brad Gibbons</span>
              <span className="block text-[0.62rem] text-muted-foreground">Studio Owner</span>
            </span>
          </div>
        </header>

        <main className="mx-auto max-w-[1500px] animate-fade-up px-4 pb-24 pt-6 md:px-6">
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/messages" component={Conversations} />
            <Route path="/bookings" component={Bookings} />
            <Route path="/checkins" component={CheckIns} />
            <Route path="/analytics" component={Analytics} />
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
