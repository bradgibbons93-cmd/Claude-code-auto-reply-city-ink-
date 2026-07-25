export default {
  content: ["./index.html", "./src/client/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["'Bodoni Moda'", "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        background: "#0B0B0C",
        foreground: "#F4F1EC",
        card: "#141416",
        input: "#1B1B1E",
        muted: { foreground: "#8B8780" },
        destructive: "#E05252",
      },
    },
  },
  plugins: [],
};
