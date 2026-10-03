import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { toast } from "sonner";
import { Check, ChevronsUpDown, LogOut, Plus, Settings2, Store, UserRound, Palette } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { initials, useSession, useSignOut, type StudioSummary } from "@/lib/session";

/** Closes on a tap outside or Escape — enough of a menu without a library. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, box };
}

export function StudioMark({ studio, size = 36, className }: { studio: Pick<StudioSummary, "name" | "logoUrl"> | null; size?: number; className?: string }) {
  if (studio?.logoUrl) {
    return (
      <img
        src={studio.logoUrl}
        alt=""
        className={cn("shrink-0 rounded-xl border border-border bg-card object-contain p-1", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-xl bg-primary font-display text-primary-foreground", className)}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials(studio?.name).slice(0, 1)}
    </span>
  );
}

/**
 * "City Ink Geelong ▾" — which studio the dashboard is showing, and every
 * other one this login runs. Switching is remembered on the account, so the
 * phone and the laptop agree about where you are.
 */
export function StudioSwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const { studio, studios, refresh } = useSession();
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const { open, setOpen, box } = usePopover();
  const change = trpc.studios.switch.useMutation({
    onSuccess: async (_d, { id }) => {
      await refresh();
      // Everything on screen belongs to the studio that was open.
      await utils.invalidate();
      const next = studios.find((s) => s.id === id);
      toast.success(`Switched to ${next?.name ?? "studio"}`);
      navigate("/");
      onNavigate?.();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card/70 p-2.5 text-left shadow-soft transition hover:border-sepia/50"
      >
        <StudioMark studio={studio} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[1.02rem] leading-tight text-charcoal">{studio?.name ?? "Your studio"}</span>
          <span className="block truncate text-[0.68rem] text-muted-foreground">
            {studio?.location || (studio?.connected ? "Inbox connected" : "Studio")}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div role="menu" className="menu-surface absolute inset-x-0 top-full z-50 mt-2 animate-menu-in rounded-2xl p-1.5">
          <p className="px-3 pb-1 pt-2 text-[0.6rem] uppercase tracking-[0.22em] text-muted-foreground">Your studios</p>
          {studios.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={s.id === studio?.id}
              disabled={change.isPending}
              onClick={() => (s.id === studio?.id ? setOpen(false) : change.mutate({ id: s.id }))}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-beige/20"
            >
              <StudioMark studio={s} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-charcoal">{s.name}</span>
                <span className="block truncate text-[0.66rem] text-muted-foreground">
                  {s.location || "No location yet"}
                  {s.connected ? " · Inbox" : ""}
                </span>
              </span>
              {s.id === studio?.id && <Check className="h-4 w-4 text-sepia" />}
            </button>
          ))}
          <div className="my-1.5 h-px bg-border" />
          <MenuLink href="/studios/new" icon={<Plus className="h-4 w-4" />} onClick={() => { setOpen(false); onNavigate?.(); }}>
            Add a studio
          </MenuLink>
          <MenuLink href="/settings?tab=studios" icon={<Store className="h-4 w-4" />} onClick={() => { setOpen(false); onNavigate?.(); }}>
            Manage studios
          </MenuLink>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onClick,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      role="menuitem"
      className="flex min-h-[40px] items-center gap-2.5 rounded-xl px-2.5 text-sm text-charcoal transition hover:bg-beige/20"
    >
      <span className="text-muted-foreground">{icon}</span>
      {children}
    </Link>
  );
}

export function UserAvatar({ size = 28 }: { size?: number }) {
  const { user } = useSession();
  return user?.avatarUrl ? (
    <img src={user.avatarUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-beige/50 font-medium text-charcoal"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(user?.name)}
    </span>
  );
}

/** The person in the corner: their photo, their name, and the way out. */
export function UserMenu() {
  const { user, studio } = useSession();
  const { open, setOpen, box } = usePopover();
  const logout = useSignOut();

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-xl border border-border py-1.5 pl-1.5 pr-1.5 transition hover:border-sepia/50 sm:pr-3"
      >
        <UserAvatar />
        <span className="hidden leading-tight sm:block">
          <span className="block max-w-[140px] truncate text-left text-xs text-charcoal">{user?.name}</span>
          <span className="block text-left text-[0.62rem] text-muted-foreground">
            {studio?.role === "owner" ? "Studio owner" : "Team"}
          </span>
        </span>
      </button>
      {open && (
        <div role="menu" className="menu-surface absolute right-0 top-full z-50 mt-2 w-64 animate-menu-in rounded-2xl p-1.5">
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <UserAvatar size={36} />
            <span className="min-w-0">
              <span className="block truncate text-sm text-charcoal">{user?.name}</span>
              <span className="block truncate text-[0.7rem] text-muted-foreground">{user?.email}</span>
            </span>
          </div>
          <div className="my-1 h-px bg-border" />
          <MenuLink href="/settings?tab=profile" icon={<UserRound className="h-4 w-4" />} onClick={() => setOpen(false)}>
            Your profile
          </MenuLink>
          <MenuLink href="/settings?tab=appearance" icon={<Palette className="h-4 w-4" />} onClick={() => setOpen(false)}>
            Appearance
          </MenuLink>
          <MenuLink href="/settings" icon={<Settings2 className="h-4 w-4" />} onClick={() => setOpen(false)}>
            Settings
          </MenuLink>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="flex min-h-[40px] w-full items-center gap-2.5 rounded-xl px-2.5 text-sm text-charcoal transition hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4 text-muted-foreground" />
            {logout.isPending ? "Logging out…" : "Log out"}
          </button>
        </div>
      )}
    </div>
  );
}
