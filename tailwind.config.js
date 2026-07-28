/**
 * Colours resolve through CSS variables so the whole app can switch themes
 * by flipping one attribute on <html>, without duplicating a `dark:` variant
 * on every element. Channels are stored space-separated so Tailwind's
 * opacity modifiers (bg-beige/30) still work.
 */
const withOpacity = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/client/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Monument Extended is the brand headline face but it's a paid
        // licence — listed first so it takes over the moment the files land,
        // with Archivo (a wide grotesque on Google Fonts) standing in.
        display: ["'Monument Extended'", "Archivo", "system-ui", "sans-serif"],
        sans: ["Montserrat", "system-ui", "sans-serif"],
        serif: ["'Monument Extended'", "Archivo", "system-ui", "sans-serif"],
      },
      colors: {
        background: withOpacity("--c-background"),
        surface: withOpacity("--c-surface"),
        foreground: withOpacity("--c-foreground"),
        card: withOpacity("--c-card"),
        input: withOpacity("--c-input"),
        border: withOpacity("--c-border"),
        muted: { foreground: withOpacity("--c-muted") },
        destructive: withOpacity("--c-destructive"),
        success: withOpacity("--c-success"),

        // Named for the light brand palette; in dark mode they resolve to the
        // purple equivalents, so one set of classes covers both themes.
        charcoal: withOpacity("--c-foreground"),
        beige: withOpacity("--c-accent"),
        sepia: withOpacity("--c-accent-strong"),

        // Solid fills that need a guaranteed-readable text colour on top.
        primary: withOpacity("--c-primary"),
        "primary-foreground": withOpacity("--c-primary-foreground"),

        amber: {
          300: withOpacity("--c-accent"),
          400: withOpacity("--c-accent-strong"),
          500: withOpacity("--c-accent"),
          600: withOpacity("--c-accent-strong"),
        },
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
        lift: "var(--shadow-lift)",
        glow: "var(--shadow-glow)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgb(var(--c-accent) / 0.55)" },
          "50%": { boxShadow: "0 0 0 8px rgb(var(--c-accent) / 0)" },
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to: { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both",
        "glow-pulse": "glow-pulse 2.6s ease-out infinite",
        shimmer: "shimmer 2.8s linear infinite",
      },
    },
  },
  plugins: [],
};
