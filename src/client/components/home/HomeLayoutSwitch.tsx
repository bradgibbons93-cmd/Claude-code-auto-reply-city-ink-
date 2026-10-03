import { Check, LayoutGrid, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/**
 * The new Home or the classic dashboard, the studio's choice.
 *
 * Brad, before the new Home went live: "can you make it easy to undo back to
 * the version it is now?" So the old dashboard stays in the app, whole, and
 * one tap on either screen swaps to the other — no redeploy, no asking
 * anyone. It's saved on the studio, so the phone and the laptop agree.
 */
export function useHomeLayout() {
  const { studio, refresh } = useSession();
  const save = trpc.studios.setAppearance.useMutation({
    onError: (error) => toast.error(error.message),
  });
  const layout = studio?.homeLayout === "classic" ? "classic" : "new";
  const set = (next: "new" | "classic", note?: string) => {
    if (!studio || next === layout) return;
    save.mutate(
      { id: studio.id, homeLayout: next },
      {
        onSuccess: async () => {
          await refresh();
          if (note) toast.success(note);
        },
      }
    );
  };
  return { layout, set, busy: save.isPending };
}

/** Under the new Home: the way back, in plain sight for the first weeks. */
export function BackToClassic() {
  const { set, busy } = useHomeLayout();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        set("classic", "Back to the classic dashboard. Switch again any time in Settings → Appearance.")
      }
      className="mx-auto flex min-h-[44px] items-center gap-2 rounded-full px-4 text-xs text-muted-foreground transition-colors hover:text-charcoal disabled:opacity-50"
    >
      <Undo2 className="h-3.5 w-3.5" /> Prefer the old dashboard? Switch back
    </button>
  );
}

/** On the classic dashboard: the new Home, one tap away. */
export function TryTheNewHome() {
  const { set, busy } = useHomeLayout();
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => set("new", "Here's the new Home. Swipe a reply right to send it.")}
      className="flex w-full min-h-[44px] items-center justify-between gap-3 rounded-2xl border border-sepia/40 bg-card px-4 py-2.5 text-left text-sm text-charcoal shadow-soft transition hover:border-sepia disabled:opacity-50"
    >
      <span className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-sepia" />
        Try the new Home — swipe to send replies
      </span>
      <span className="shrink-0 text-xs font-medium text-sepia">Switch</span>
    </button>
  );
}

/** Settings → Appearance. */
export function HomeLayoutPicker() {
  const { layout, set, busy } = useHomeLayout();
  const options = [
    { id: "new" as const, title: "New Home", body: "Replies you swipe to send, today's bookings and posts at a glance.", icon: Sparkles },
    { id: "classic" as const, title: "Classic dashboard", body: "The dashboard from before: stats, lists and the live feed.", icon: LayoutGrid },
  ];
  return (
    <div role="radiogroup" aria-label="Home screen" className="grid gap-3 sm:grid-cols-2">
      {options.map(({ id, title, body, icon: Icon }) => {
        const on = layout === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={busy}
            onClick={() => set(id, id === "new" ? "Using the new Home" : "Using the classic dashboard")}
            className={cn(
              "flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors disabled:opacity-60",
              on ? "border-sepia bg-sepia/10" : "border-border bg-card hover:border-sepia/60"
            )}
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-sepia" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold text-charcoal">
                {title}
                {on && <Check className="h-4 w-4 text-sepia" />}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
