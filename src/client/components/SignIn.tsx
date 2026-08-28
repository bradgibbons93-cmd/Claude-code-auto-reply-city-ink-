import { useState } from "react";
import { StampBadge } from "./Logo";

/**
 * The studio's door. Only ever shown when DASHBOARD_PASSWORD is set on the
 * server — with no password configured the app opens as it always has, which
 * is what keeps Meta's reviewers able to see it.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (result.ok) {
        setPassword("");
        onSignedIn();
      } else {
        setError(result.error || "That's not the password.");
      }
    } catch {
      setError("Couldn't reach the studio. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <form
        onSubmit={submit}
        className="w-full max-w-sm animate-fade-up rounded-2xl border border-border bg-card p-7 shadow-lg"
      >
        <div className="flex flex-col items-center text-center">
          <StampBadge className="h-16 w-16" />
          <h1 className="mt-4 font-display text-2xl text-charcoal">City Ink Tattoo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Studio dashboard — sign in to carry on.
          </p>
        </div>

        <label className="mt-6 block text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
          Password
        </label>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-charcoal outline-none transition-colors focus:border-sepia"
          placeholder="••••••••"
        />

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={busy || !password.trim()}
          className="mt-5 w-full rounded-xl bg-charcoal px-4 py-2.5 text-sm text-background transition-opacity disabled:opacity-50"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>

        <p className="mt-4 text-center text-[0.68rem] leading-relaxed text-muted-foreground">
          Artists uploading the day's photos don't need this — the QR code on the wall goes
          straight through.
        </p>
      </form>
    </div>
  );
}
