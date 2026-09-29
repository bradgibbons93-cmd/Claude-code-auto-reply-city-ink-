import { useRef } from "react";
import { Check, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEMES, getTheme, isHex, resolveMode, type Look, type Mode } from "@/lib/themes";
import { DashboardPreview, type PreviewIdentity } from "@/components/DashboardPreview";

const MODES: { id: Mode | null; label: string; icon: typeof Sun | null }[] = [
  { id: null, label: "Theme default", icon: null },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

/**
 * Visual theme choice: every card is the studio's own dashboard in that look,
 * not a colour swatch and a name. Controlled — the caller decides when to save.
 */
export function ThemeCards({
  look,
  identity,
  onChange,
  columns = "grid-cols-2 md:grid-cols-3",
}: {
  look: Look;
  identity: PreviewIdentity;
  onChange: (look: Look) => void;
  columns?: string;
}) {
  const current = getTheme(look.theme).id;
  return (
    <div className={cn("grid gap-3 sm:gap-4", columns)}>
      {THEMES.map((t) => {
        const chosen = t.id === current;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange({ theme: t.id, mode: null, accent: null })}
            aria-pressed={chosen}
            aria-label={`${t.name} theme`}
            className={cn(
              "group relative overflow-hidden rounded-2xl border text-left transition-all duration-300",
              chosen
                ? "border-sepia shadow-glow"
                : "border-border hover:-translate-y-1 hover:border-sepia/40 hover:shadow-soft"
            )}
          >
            <div className="pointer-events-none">
              <DashboardPreview look={{ theme: t.id }} identity={identity} className="max-h-[200px] sm:max-h-[240px]" />
            </div>
            <div className="relative border-t border-border bg-card p-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-charcoal">
                {t.name}
                {chosen && <Check className="h-3.5 w-3.5 text-sepia" />}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[0.72rem] leading-snug text-muted-foreground">{t.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Accent colour and light/dark for the chosen theme. */
export function LookControls({ look, onChange }: { look: Look; onChange: (look: Look) => void }) {
  const theme = getTheme(look.theme);
  const picker = useRef<HTMLInputElement>(null);
  const own = theme[resolveMode(look)].accent.join(",");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-charcoal">Accent colour</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Buttons, highlights and the active menu item.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {[null, ...theme.accents].map((hex) => {
            const active = (look.accent ?? null) === hex;
            return (
              <button
                key={hex ?? "auto"}
                type="button"
                onClick={() => onChange({ ...look, accent: hex })}
                aria-label={hex ? `Accent ${hex}` : "The theme's own accent"}
                aria-pressed={active}
                className={cn(
                  "relative h-10 w-10 rounded-full border-2 transition-transform duration-200 hover:scale-110",
                  active ? "border-charcoal ring-2 ring-sepia/40 ring-offset-2 ring-offset-background" : "border-transparent"
                )}
                style={{ background: hex ?? `rgb(${own})` }}
              >
                {!hex && (
                  <span className="absolute inset-0 flex items-center justify-center text-[0.5rem] font-bold tracking-wide text-white mix-blend-difference">
                    AUTO
                  </span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => picker.current?.click()}
            className={cn(
              "relative h-10 w-10 overflow-hidden rounded-full border-2 bg-[conic-gradient(from_0deg,#f87171,#fbbf24,#34d399,#60a5fa,#a78bfa,#f472b6,#f87171)] transition-transform hover:scale-110",
              isHex(look.accent) && !theme.accents.includes(look.accent) ? "border-charcoal" : "border-transparent"
            )}
            aria-label="Pick any colour"
            title="Any colour"
          />
          <input
            ref={picker}
            type="color"
            className="sr-only"
            tabIndex={-1}
            value={isHex(look.accent) ? look.accent : "#d9a94e"}
            onChange={(e) => onChange({ ...look, accent: e.target.value })}
          />
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-charcoal">Light or dark</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {MODES.map(({ id, label, icon: Icon }) => {
            const active = (look.mode ?? null) === id;
            return (
              <button
                key={label}
                type="button"
                onClick={() => onChange({ ...look, mode: id })}
                aria-pressed={active}
                className={cn(
                  "flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border text-xs transition",
                  active ? "border-sepia bg-sepia/10 text-charcoal" : "border-border text-muted-foreground hover:text-charcoal"
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
