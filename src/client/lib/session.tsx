import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { applyLook, clearLook } from "@/lib/themes";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../server/routers";
import { applyArt } from "@/lib/art";

type Me = inferRouterOutputs<AppRouter>["account"]["me"];
export type SessionUser = NonNullable<Me["user"]>;
export type StudioSummary = Me["studios"][number];

interface Session {
  loading: boolean;
  me: Me | undefined;
  user: SessionUser | null;
  studios: StudioSummary[];
  studio: StudioSummary | null;
  /** The open studio holds the connected inbox — the data pages will answer. */
  connected: boolean;
  refresh: () => Promise<unknown>;
}

const SessionContext = createContext<Session | null>(null);

/**
 * Who is signed in, which studio they have open, and that studio's look.
 *
 * One query (`account.me`) feeds every screen, so the header, the switcher,
 * the greeting and the theme can never disagree about who or where you are.
 * The look is applied here, the moment it's known, so the whole app — not
 * just the page that asked — wears the studio's theme.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const query = trpc.account.me.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const me = query.data;
  const studio = me?.studios.find((s) => s.id === me.currentStudioId) ?? me?.studios[0] ?? null;

  useEffect(() => {
    if (!me?.user || !studio) return;
    applyLook({ theme: studio.theme, mode: studio.mode, accent: studio.accent });
    applyArt(studio.art);
  }, [me?.user, studio?.theme, studio?.mode, studio?.accent, studio?.art, studio]);

  const value = useMemo<Session>(
    () => ({
      loading: query.isLoading,
      me,
      user: me?.user ?? null,
      studios: me?.studios ?? [],
      studio,
      connected: !!studio?.connected,
      refresh: () => query.refetch(),
    }),
    [query.isLoading, me, studio, query]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside <SessionProvider>");
  return session;
}

export function firstName(name: string | null | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export function initials(name: string | null | undefined) {
  return (
    (name ?? "")
      .trim()
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * Log out cleanly.
 *
 * A full page load onto the log-in screen, not a client-side hop: the hop
 * raced the session — for a frame the app still believed you were signed in,
 * its "signed-in people don't need the log-in page" rule sent you home, and
 * you landed on the marketing page instead of log in. A reload also drops
 * every cached answer and the studio's colours from this device, which is
 * what logging out of a shared phone should do.
 */
export function useSignOut() {
  return trpc.account.logout.useMutation({
    onSettled: () => {
      clearLook();
      window.location.replace("/login");
    },
  });
}
