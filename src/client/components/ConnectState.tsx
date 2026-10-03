import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowRightLeft, Instagram, Facebook, Settings2, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/lib/session";
import { Card, CardContent } from "@/components/ui/card";

/**
 * What a studio without a connected inbox sees where the inbox would be.
 *
 * Honest rather than empty: this deployment's Meta connection belongs to one
 * studio. Others get their own once Runnit's own Meta app is live. Until
 * then everything else about them — details, branding, look — is real and
 * saved, and the studio that does have an inbox is one tap away.
 */
export function ConnectState({ what = "Messages" }: { what?: string }) {
  const { studio, studios, refresh } = useSession();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const connected = studios.find((s) => s.connected);
  const change = trpc.studios.switch.useMutation({
    onSuccess: async () => {
      await refresh();
      await utils.invalidate();
      navigate("/");
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Card className="mx-auto max-w-2xl animate-fade-up overflow-hidden">
      <CardContent className="space-y-6 p-7 sm:p-10">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white shadow-soft">
            <Instagram className="h-5 w-5" />
          </span>
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0a7cff] text-white shadow-soft">
            <Facebook className="h-5 w-5" />
          </span>
        </div>
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.24em] text-sepia">{what}</p>
          <h1 className="mt-2 font-display text-2xl leading-tight text-charcoal sm:text-3xl">
            {studio?.name ?? "This studio"}'s inbox isn't connected yet
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Runnit reads each studio's Instagram and Facebook messages through its own Meta connection. Extra studios
            switch on with Runnit's own Meta app. Until then, this studio's details, branding and look are saved and
            ready, and nothing here is sample data.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {connected && connected.id !== studio?.id && (
            <button
              type="button"
              onClick={() => change.mutate({ id: connected.id })}
              disabled={change.isPending}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-soft transition hover:-translate-y-0.5 disabled:opacity-60"
            >
              <ArrowRightLeft className="h-4 w-4" />
              {change.isPending ? "Switching…" : `Go to ${connected.name}`}
            </button>
          )}
          <Link
            href="/settings?tab=studio"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-border px-5 text-sm text-charcoal transition hover:border-sepia/60"
          >
            <Settings2 className="h-4 w-4" />
            Studio settings
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The home screen for a studio with no inbox: whose workspace it is, what's
 * set up, and what's still to do — every item a real setting.
 */
export function StudioHome() {
  const { user, studio } = useSession();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (user?.name ?? "").split(" ")[0];
  const checklist: [string, boolean, string][] = [
    ["Studio name and location", !!studio?.name && !!studio?.location, "/settings?tab=studio"],
    ["Logo", !!studio?.logoUrl, "/settings?tab=studio"],
    ["Banner photo", !!studio?.coverUrl, "/settings?tab=studio"],
    ["Your look", !!studio?.theme, "/settings?tab=appearance"],
    ["Your profile photo", !!user?.avatarUrl, "/settings?tab=profile"],
  ];
  const done = checklist.filter(([, ok]) => ok).length;

  return (
    <div className="space-y-6">
      <section
        className="relative overflow-hidden rounded-2xl px-6 py-8 sm:px-9 sm:py-10"
        style={{
          background: "linear-gradient(135deg, rgb(var(--c-banner)) 0%, rgb(var(--c-banner-deep)) 100%)",
          color: "rgb(var(--c-banner-fg))",
        }}
      >
        {studio?.coverUrl && (
          <>
            <img src={studio.coverUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-60" />
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(100deg, rgb(var(--c-banner-deep)) 0%, rgb(var(--c-banner-deep) / 0.8) 45%, rgb(var(--c-banner-deep) / 0.2) 100%)",
              }}
            />
          </>
        )}
        <div className="relative">
          <p className="text-[0.6rem] uppercase tracking-[0.42em]" style={{ color: "rgb(var(--c-banner-accent))" }}>
            {[studio?.name, studio?.location].filter(Boolean).join(" · ")}
          </p>
          <h1 className="mt-3 font-display text-3xl leading-tight sm:text-4xl">
            {greeting}
            {first ? `, ${first}` : ""}
          </h1>
          <p className="mt-2 max-w-lg text-sm opacity-75">
            {studio?.name} is set up. {done < checklist.length ? `${checklist.length - done} small things left to make it yours.` : "Everything's in place."}
          </p>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardContent className="space-y-1 p-6">
            <p className="flex items-center gap-2 font-display text-lg text-charcoal">
              <Sparkles className="h-4 w-4 text-sepia" /> Make it yours
              <span className="ml-auto text-xs text-muted-foreground">
                {done}/{checklist.length}
              </span>
            </p>
            <div className="mb-2 mt-3 h-1.5 overflow-hidden rounded-full bg-border">
              <span className="block h-full rounded-full bg-sepia transition-all duration-700" style={{ width: `${(done / checklist.length) * 100}%` }} />
            </div>
            {checklist.map(([label, ok, href]) => (
              <Link
                key={label}
                href={href}
                className="flex min-h-[44px] items-center gap-3 rounded-xl px-2 text-sm transition hover:bg-beige/15"
              >
                <span
                  className={
                    ok
                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-sepia text-[0.6rem] text-primary-foreground"
                      : "h-5 w-5 rounded-full border border-border"
                  }
                >
                  {ok ? "✓" : ""}
                </span>
                <span className={ok ? "text-muted-foreground line-through decoration-border" : "text-charcoal"}>{label}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <ConnectState what="Inbox" />
      </div>
    </div>
  );
}
