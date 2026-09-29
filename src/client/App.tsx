import { useEffect, useState } from "react";
import { Link, Redirect, Route, Switch, useLocation } from "wouter";
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
  Images,
  Rss,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/lib/session";
import { resolveMode } from "@/lib/themes";
import { InkDefs } from "@/components/Logo";
import { StudioSwitcher, UserMenu } from "@/components/StudioSwitcher";
import { ConnectState, StudioHome } from "@/components/ConnectState";
import InboxSearch from "@/components/InboxSearch";
import Dashboard from "./pages/Dashboard";
import Conversations from "./pages/Conversations";
import Bookings from "./pages/Bookings";
import CheckIns from "./pages/CheckIns";
import Analytics from "./pages/Analytics";
import AutoReplyRules from "./pages/AutoReplyRules";
import PostScheduler from "./pages/PostScheduler";
import Training from "./pages/Training";
import SettingsPage from "./pages/SettingsPage";
import NewStudio from "./pages/NewStudio";
import Landing from "./pages/Landing";
import Onboarding from "./pages/onboarding/Onboarding";
import { LoginPage, SignupPage } from "./pages/auth/AuthPages";
import Upload from "./pages/Upload";
import StudioGallery from "./pages/StudioGallery";
import Feed from "./pages/Feed";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutGrid, badge: false },
  { href: "/messages", label: "Messages", icon: MessageSquare, badge: true },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck, badge: false },
  { href: "/checkins", label: "Check-ins", icon: CheckCircle2, badge: false },
  { href: "/analytics", label: "Analytics", icon: BarChart3, badge: false },
  { href: "/posts", label: "Content", icon: ImageIcon, badge: false },
  { href: "/feed", label: "Live feed", icon: Rss, badge: false },
  { href: "/gallery", label: "Studio gallery", icon: Images, badge: false },
  { href: "/training", label: "AI Training", icon: Sparkles, badge: false },
  { href: "/rules", label: "Auto-replies", icon: Zap, badge: false },
  { href: "/settings", label: "Settings", icon: SettingsIcon, badge: false },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const { connected, studio } = useSession();
  const { data: pending } = trpc.pendingReplies.list.useQuery(undefined, {
    refetchInterval: 10000,
    enabled: connected,
  });

  return (
    <div className="flex h-full flex-col">
      {/* Which studio this is, and every other one — the switcher. */}
      <div className="px-4 pb-5 pt-6">
        <StudioSwitcher onNavigate={onNavigate} />
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map(({ href, label, icon: Icon, badge }) => {
          const active = href === "/" ? location === "/" : location.startsWith(href);
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

      <div className="mt-auto flex flex-col items-center gap-3 px-6 pb-8 pt-10">
        {studio?.logoUrl && (
          <img src={studio.logoUrl} alt="" className="h-16 w-16 object-contain opacity-80" />
        )}
        {studio?.tagline && (
          <p className="text-center text-[0.6rem] uppercase tracking-[0.24em] text-muted-foreground">{studio.tagline}</p>
        )}
        <p className="flex items-center gap-1.5 text-[0.55rem] uppercase tracking-[0.3em] text-muted-foreground/80">
          <img src="/brand/runnit-emblem.png" alt="" className="h-3.5 w-3.5 object-contain" />
          Powered by Runnit
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
    // Bottom-right rather than centred: sitting in the middle of the page it
    // covered whatever card happened to be under it, which on the dashboard
    // was the top of a scheduled post.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-end pb-4 pr-3 sm:pr-6">
      {/* Compact on a phone. At full width this is 250px of a 390px screen
          and it sat straight across a customer's name on the draft board —
          the one thing on that card you need to read. The dot is the signal;
          the sentence is the desktop's luxury. */}
      <div className="glass pointer-events-auto flex items-center gap-4 rounded-full border px-3 py-1.5 text-xs text-muted-foreground shadow-soft sm:px-5 sm:py-2">
        <span className="flex items-center gap-2">
          <span className="live-dot" />
          <span className="text-charcoal sm:hidden">Live</span>
          <span className="hidden text-charcoal sm:inline">System live &amp; running</span>
        </span>
        <span className="hidden tabular-nums sm:inline">
          Last updated {now.toLocaleTimeString("en-AU", { hour12: false })}
        </span>
      </div>
    </div>
  );
}

/** Pages that read the connected inbox. A studio without one gets ConnectState. */
const DATA_ROUTES: [string, React.ComponentType][] = [
  ["/messages", Conversations],
  ["/bookings", Bookings],
  ["/checkins", CheckIns],
  ["/analytics", Analytics],
  ["/training", Training],
  ["/rules", AutoReplyRules],
  ["/posts", PostScheduler],
  ["/feed", Feed],
  ["/gallery", StudioGallery],
];

function Splash() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background">
      <img src="/brand/runnit-emblem.png" alt="" className="h-12 w-12 animate-pulse object-contain opacity-70" />
    </div>
  );
}

/**
 * Who sees what.
 *
 *   signed out            → the landing page (where sign-up is public) or log in
 *   signed in, not set up → onboarding, resumed where it was left
 *   set up                → their workspace, and never onboarding again
 *
 * The artists' QR upload page stays open to everyone, as it always was.
 */
export default function App() {
  const [location] = useLocation();
  const { loading, me, user } = useSession();

  if (location === "/upload") {
    return (
      <div className="min-h-screen text-foreground">
        <InkDefs />
        <Upload />
      </div>
    );
  }

  if (loading) return <Splash />;
  if (!me) return <Unreachable />;

  if (!user) {
    return (
      <Switch>
        <Route path="/">{me.signupsOpen ? <Landing /> : <Redirect to="/login" replace />}</Route>
        <Route path="/login" component={LoginPage} />
        <Route path="/signup" component={SignupPage} />
        <Route>
          <Redirect
            to={`/login?next=${encodeURIComponent(location + window.location.search)}${me.expired ? "&expired=1" : ""}`}
            replace
          />
        </Route>
      </Switch>
    );
  }

  if (!user.onboardingComplete) {
    return location === "/welcome" ? <Onboarding /> : <Redirect to="/welcome" replace />;
  }

  if (location === "/login" || location === "/signup" || location === "/welcome") {
    // Straight on to wherever they were headed before being asked to log in.
    const next = new URLSearchParams(window.location.search).get("next");
    const safe = next && next.startsWith("/") && !next.startsWith("//") && !/^\/(login|signup|welcome)/.test(next);
    return <Redirect to={safe ? next : "/"} replace />;
  }

  return <Workspace />;
}

/** The session couldn't be read at all — the server is down or unreachable. */
function Unreachable() {
  const { refresh } = useSession();
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <img src="/brand/runnit-emblem.png" alt="" className="h-12 w-12 object-contain opacity-70" />
      <p className="font-display text-xl text-charcoal">Can't reach Runnit right now</p>
      <p className="max-w-sm text-sm text-muted-foreground">Check your connection. If it's fine, the server may be restarting — try again in a moment.</p>
      <button
        type="button"
        onClick={() => void refresh()}
        className="min-h-[44px] rounded-full bg-primary px-5 text-sm text-primary-foreground"
      >
        Try again
      </button>
    </div>
  );
}

function Workspace() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();
  const { studio, connected, refresh } = useSession();
  const mode = resolveMode({ theme: studio?.theme, mode: studio?.mode });

  const { data: pending } = trpc.pendingReplies.list.useQuery(undefined, {
    refetchInterval: 10000,
    enabled: connected,
  });

  // Light/dark is part of the studio's look, so flipping it here saves it —
  // the phone and the laptop stay in step.
  const setAppearance = trpc.studios.setAppearance.useMutation({
    onSuccess: () => refresh(),
    onError: (error) => toast.error(error.message),
  });
  const toggleMode = () => {
    if (!studio) return;
    setAppearance.mutate({ id: studio.id, mode: mode === "dark" ? "light" : "dark" });
  };

  useEffect(() => setMenuOpen(false), [location]);
  // A new page starts at the top. Without this you arrived wherever the last
  // page had been scrolled to — halfway down a checklist, under the header.
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0 });
  }, [location]);

  return (
    <div className="min-h-screen text-foreground">
      {/* The turbulence filter the inked logo references — declared once. */}
      <InkDefs />

      <aside className="glass fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r lg:block">
        <Sidebar />
      </aside>

      {menuOpen && (
        <>
          <button
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-30 bg-background/60 backdrop-blur-sm lg:hidden"
          />
          <aside className="glass fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] animate-fade-up overflow-y-auto border-r lg:hidden">
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </aside>
        </>
      )}

      <div className="lg:pl-64">
        <header className="glass sticky top-0 z-20 flex items-center gap-2.5 border-b px-4 py-3 md:px-6">
          <button
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-lg p-2 text-charcoal transition-colors hover:bg-beige/25 lg:hidden"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          {connected ? (
            <InboxSearch />
          ) : (
            <p className="truncate font-display text-lg text-charcoal md:hidden">{studio?.name}</p>
          )}

          <div className="flex-1" />

          {connected && (
            <span className="hidden items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-xs sm:flex">
              <span className="live-dot" />
              <span className="text-charcoal">Live</span>
            </span>
          )}

          {connected && (
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
          )}

          <button
            onClick={toggleMode}
            disabled={setAppearance.isPending}
            aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={mode === "dark" ? "Light mode" : "Dark mode"}
            className="rounded-full border border-border p-2 text-charcoal transition-all duration-300 hover:border-sepia hover:shadow-glow"
          >
            {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <UserMenu />
        </header>

        <main key={studio?.id} className="mx-auto max-w-[1500px] animate-fade-up px-4 pb-24 pt-6 md:px-6">
          <Switch>
            <Route path="/">{connected ? <Dashboard /> : <StudioHome />}</Route>
            {DATA_ROUTES.map(([path, Page]) => (
              <Route key={path} path={path}>
                {connected ? <Page /> : <ConnectState what={NAV.find((n) => n.href === path)?.label} />}
              </Route>
            ))}
            <Route path="/settings" component={SettingsPage} />
            <Route path="/studios/new" component={NewStudio} />
            <Route>
              <div className="py-16 text-center">
                <p className="font-display text-2xl text-charcoal">That page doesn't exist.</p>
                <Link href="/" className="mt-4 inline-block text-sm text-sepia underline">
                  Back to your dashboard
                </Link>
              </div>
            </Route>
          </Switch>
        </main>
      </div>

      {connected && <StatusBar />}
    </div>
  );
}
