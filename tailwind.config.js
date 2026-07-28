export default {
  content: ["./index.html", "./src/client/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Monument Extended is the brand headline face, but it's a paid
        // licence — it's listed first so it takes over the moment the files
        // are added, with Archivo (a wide grotesque on Google Fonts)
        // standing in until then.
        display: ["'Monument Extended'", "Archivo", "system-ui", "sans-serif"],
        sans: ["Montserrat", "system-ui", "sans-serif"],
        // Kept so any page still on the old classes renders sensibly.
        serif: ["'Monument Extended'", "Archivo", "system-ui", "sans-serif"],
      },
      colors: {
        // Brand book, section 09.
        charcoal: "#1A1A1A",
        beige: "#D0C3A8",
        sepia: "#A38B7A",

        background: "#FFFFFF",
        surface: "#FAF8F5",
        foreground: "#1A1A1A",
        card: "#FFFFFF",
        input: "#FFFFFF",
        border: "#EDE7DE",
        muted: { foreground: "#8A8178" },
        destructive: "#B4544A",
        success: "#5A7A5E",
        // The old dark theme leaned on amber-*; mapping it to the brand
        // beige keeps existing pages on-brand without touching every class.
        amber: {
          300: "#DFD5BF",
          400: "#A38B7A",
          500: "#D0C3A8",
          600: "#8C7563",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(26,26,26,0.04), 0 8px 24px -12px rgba(26,26,26,0.10)",
        lift: "0 2px 4px rgba(26,26,26,0.05), 0 18px 40px -16px rgba(26,26,26,0.16)",
        glow: "0 0 0 1px rgba(208,195,168,0.5), 0 0 28px -6px rgba(208,195,168,0.55)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        breathe: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.45", transform: "scale(0.85)" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(208,195,168,0.55)" },
          "50%": { boxShadow: "0 0 0 8px rgba(208,195,168,0)" },
        },
        shimmer: {
          from: { backgroundPosition: "-200% 0" },
          to: { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both",
        breathe: "breathe 2.4s ease-in-out infinite",
        "glow-pulse": "glow-pulse 2.6s ease-out infinite",
        shimmer: "shimmer 2.8s linear infinite",
      },
    },
  },
  plugins: [],
};
