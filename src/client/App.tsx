import { Link, Route, Switch, useLocation } from "wouter";
import { MessageSquare, Zap, Calendar, BrainCircuit, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import Conversations from "./pages/Conversations";
import AutoReplyRules from "./pages/AutoReplyRules";
import PostScheduler from "./pages/PostScheduler";
import Training from "./pages/Training";
import Settings from "./pages/Settings";

const NAV = [
  { href: "/", label: "Conversations", icon: MessageSquare },
  { href: "/training", label: "Training", icon: BrainCircuit },
  { href: "/rules", label: "Auto-replies", icon: Zap },
  { href: "/posts", label: "Posts", icon: Calendar },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function Nav() {
  const [location] = useLocation();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-amber-500/15 px-4 md:px-8">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = location === href;
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-2 border-b-2 px-3 py-4 text-sm transition-colors",
              active
                ? "border-amber-400 text-amber-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="px-4 pt-8 md:px-8">
        <p className="text-xs uppercase tracking-[0.2em] text-amber-500/60">City Ink</p>
        <h1 className="mt-1 font-serif text-3xl">Front of House</h1>
      </header>

      <Nav />

      <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
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
  );
}
