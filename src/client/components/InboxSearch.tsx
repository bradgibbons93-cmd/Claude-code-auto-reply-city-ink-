import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Search, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";

/**
 * The search box in the header, which used to do nothing at all.
 *
 * It searches names AND message text, because the studio remembers "the bloke
 * who wanted the koi on his forearm" far more reliably than it remembers his
 * name — and the line that matched is what comes back, so a result is
 * recognisable without opening it.
 *
 * Picking one opens that thread on the Messages page. The thread id travels
 * in the URL rather than in React state, so a result can be linked to, opened
 * in a new tab, and comes back on a refresh.
 */
export default function InboxSearch() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const box = useRef<HTMLDivElement>(null);

  // A keystroke is not a search. Without this every letter of a name is a
  // round trip and a LIKE across every message the studio has ever had.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const { data: results, isFetching } = trpc.search.useQuery(
    { query: debounced },
    { enabled: debounced.length >= 2, staleTime: 15000 }
  );

  // Clicking anywhere else closes it. Without this the panel sits over the
  // page until something else is typed.
  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function pick(conversationId: string) {
    setOpen(false);
    setQuery("");
    navigate(`/messages?thread=${encodeURIComponent(conversationId)}`);
  }

  const showPanel = open && debounced.length >= 2;

  return (
    <div ref={box} className="relative hidden min-w-0 flex-1 md:block lg:max-w-md">
      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && results?.length) pick(results[0].conversationId);
          }}
          placeholder="Search a name, or something they said…"
          className="h-10 w-full rounded-xl border border-border bg-input pl-9 pr-9 text-sm transition-all duration-300 placeholder:text-muted-foreground focus:border-sepia/60 focus:shadow-glow focus:outline-none"
        />
        {!!query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
            aria-label="Clear search"
            className="absolute right-2 rounded-full p-1 text-muted-foreground hover:text-charcoal"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </label>

      {showPanel && (
        <div className="menu-surface absolute left-0 right-0 top-12 z-40 max-h-96 overflow-y-auto rounded-xl p-1">
          {results?.length ? (
            results.map((row) => (
              <button
                key={row.conversationId}
                type="button"
                onClick={() => pick(row.conversationId)}
                className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-beige/25"
              >
                <Avatar name={row.senderName || "?"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-charcoal">
                    {row.senderName || "Unknown customer"}
                    {row.platform === "instagram" && (
                      <span className="ml-2 text-[0.6rem] uppercase tracking-[0.14em] text-sepia">
                        Instagram
                      </span>
                    )}
                  </span>
                  {row.snippet && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.snippet}
                    </span>
                  )}
                </span>
              </button>
            ))
          ) : (
            <p className="p-3 text-sm text-muted-foreground">
              {isFetching ? "Looking…" : `Nothing matching "${debounced}".`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
