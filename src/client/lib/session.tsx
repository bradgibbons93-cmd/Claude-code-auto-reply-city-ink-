import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { applyLook } from "@/lib/themes";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../server/routers";

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
  }, [me?.user, studio?.theme, studio?.mode, studio?.accent, studio]);

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
 * Log out cleanly: say "nobody" first, so the workspace unmounts at once, then
 * forget every cached answer. Refetching the dashboard on the way out only
 * produced a burst of "Log in first" errors from a screen nobody could see.
 */
export function useSignOut() {
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const logout = trpc.account.logout.useMutation({
    onSettled: () => {
      utils.account.me.setData(undefined, (old) =>
        old ? { ...old, user: null, studios: [], currentStudioId: null, claimable: null, expired: false } : old
      );
      queryClient.removeQueries({ predicate: (q) => JSON.stringify(q.queryKey).indexOf('"me"') === -1 });
      navigate("/login", { replace: true });
      void utils.account.me.invalidate();
    },
  });
  return logout;
}
