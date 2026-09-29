/**
 * The looks a studio can choose from.
 *
 * Every colour in the app resolves through CSS variables (index.css), so a
 * theme is nothing more than a set of those variables. Set them on <html> and
 * the whole dashboard changes; set them on a single <div> and only what's
 * inside it does — which is how onboarding shows a live preview of each look
 * without touching the rest of the page.
 *
 * Each theme has a light and a dark version and a default between them. A
 * studio can also pick its own accent colour, which replaces the theme's.
 * Colours are "r g b" triples so Tailwind's opacity modifiers keep working.
 */

import type { CSSProperties } from "react";

export type Mode = "light" | "dark";
export type ThemeId = "ink" | "coffee" | "noir" | "silver" | "crimson" | "blush" | "sage" | "midnight";

type RGB = [number, number, number];

interface Palette {
  background: RGB;
  surface: RGB;
  foreground: RGB;
  card: RGB;
  input: RGB;
  elevated: RGB;
  border: RGB;
  muted: RGB;
  accent: RGB; // the key colour — buttons, active states, headings' accents
  wash?: RGB; // a soft fill behind icons; derived from accent when absent
  alt?: RGB; // the counter-light for gradients; derived when absent
  destructive: RGB;
  success: RGB;
  banner: RGB;
  bannerDeep: RGB;
  bannerFg: RGB;
}

export interface Theme {
  id: ThemeId;
  name: string;
  description: string;
  defaultMode: Mode;
  display: string;
  sans: string;
  light: Palette;
  dark: Palette;
  /** Accents that suit this look, offered first. */
  accents: string[];
}

const hex = (value: string): RGB => {
  const n = parseInt(value.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const BODONI = `"Bodoni Moda", Didot, Georgia, serif`;
const MONTSERRAT = `Montserrat, system-ui, sans-serif`;
const INTER = `"Inter Tight", system-ui, sans-serif`;
const FRAUNCES = `Fraunces, Georgia, serif`;
const SYNE = `Syne, "Inter Tight", system-ui, sans-serif`;
// Tall poster capitals over a plain, modern body. No serif anywhere: Brad
// asked for the Bodoni headings to go, and this is the look he picked.
const OSWALD = `Oswald, "Arial Narrow", system-ui, sans-serif`;
const INSTRUMENT = `"Instrument Sans", "Inter Tight", system-ui, sans-serif`;

export const THEMES: Theme[] = [
  {
    id: "ink",
    name: "Black & Gold Ink",
    description: "Black, warm gold and tall poster type. The one the new home screen was drawn in.",
    defaultMode: "dark",
    display: OSWALD,
    sans: INSTRUMENT,
    accents: ["#D9AE5F", "#C08A5B", "#E8D5A8", "#B76E79", "#8FA3B8"],
    dark: {
      background: hex("#0C0A08"),
      surface: hex("#13100D"),
      foreground: hex("#F6F0E6"),
      card: hex("#16120E"),
      input: hex("#080706"),
      elevated: hex("#1C1712"),
      border: hex("#2E2720"),
      muted: hex("#B3A898"),
      accent: hex("#D9AE5F"),
      destructive: hex("#EF7B6E"),
      success: hex("#79C28F"),
      banner: hex("#16120E"),
      bannerDeep: hex("#070605"),
      bannerFg: hex("#F6F0E6"),
    },
    light: {
      background: hex("#F4EFE6"),
      surface: hex("#FAF6EF"),
      foreground: hex("#16120E"),
      card: hex("#FFFCF6"),
      input: hex("#FFFFFF"),
      elevated: hex("#FFFFFF"),
      border: hex("#E2D8C6"),
      muted: hex("#6F665A"),
      accent: hex("#8E6420"),
      destructive: hex("#A8463B"),
      success: hex("#3E7A52"),
      banner: hex("#16120E"),
      bannerDeep: hex("#070605"),
      bannerFg: hex("#F6F0E6"),
    },
  },
  {
    id: "noir",
    name: "Noir & Gold",
    description: "Black, warm gold, editorial serif. The premium one.",
    defaultMode: "dark",
    display: BODONI,
    sans: INTER,
    accents: ["#D9A94E", "#C9A27C", "#E8D5A8", "#B76E79", "#8FA3B8"],
    dark: {
      background: hex("#0A0A0C"),
      surface: hex("#121215"),
      foreground: hex("#F2EEE6"),
      card: hex("#141417"),
      input: hex("#070708"),
      elevated: hex("#18181C"),
      border: hex("#2A2824"),
      muted: hex("#A39E95"),
      accent: hex("#D9A94E"),
      destructive: hex("#EF7B6E"),
      success: hex("#79C28F"),
      banner: hex("#16140F"),
      bannerDeep: hex("#070706"),
      bannerFg: hex("#F2EEE6"),
    },
    light: {
      background: hex("#F6F3EC"),
      surface: hex("#FBF9F4"),
      foreground: hex("#16140F"),
      card: hex("#FFFDF8"),
      input: hex("#FFFFFF"),
      elevated: hex("#FFFFFF"),
      border: hex("#E1D9C8"),
      muted: hex("#6F685B"),
      accent: hex("#9A6B1F"),
      destructive: hex("#A8463B"),
      success: hex("#3E7A52"),
      banner: hex("#16140F"),
      bannerDeep: hex("#070706"),
      bannerFg: hex("#F2EEE6"),
    },
  },
  {
    id: "coffee",
    name: "Coffee & Silver",
    description: "Espresso brown and silver grey, Bodoni wordmark. Warm and classic.",
    defaultMode: "light",
    display: BODONI,
    sans: MONTSERRAT,
    accents: ["#6F5A4B", "#8B6B4E", "#4A5A6A", "#7A4B4B", "#5B6B4F"],
    light: {
      background: hex("#E9E9EA"),
      surface: hex("#F2F2F3"),
      foreground: hex("#1A1A1A"),
      card: hex("#F9F9FA"),
      input: hex("#FDFDFD"),
      elevated: hex("#FFFFFF"),
      border: [205, 200, 195],
      muted: [108, 102, 97],
      accent: hex("#6F5A4B"),
      wash: [219, 210, 202],
      alt: [154, 128, 108],
      destructive: [165, 70, 60],
      success: [74, 106, 78],
      banner: [42, 33, 27],
      bannerDeep: [22, 17, 13],
      bannerFg: [233, 233, 234],
    },
    dark: {
      background: [20, 16, 14],
      surface: [30, 24, 21],
      foreground: [233, 233, 234],
      card: [27, 21, 18],
      input: [13, 10, 8],
      elevated: [25, 19, 16],
      border: [60, 48, 40],
      muted: [167, 156, 147],
      accent: [217, 195, 172],
      wash: [196, 169, 143],
      alt: [159, 163, 166],
      destructive: [240, 130, 120],
      success: [122, 190, 140],
      banner: [33, 26, 21],
      bannerDeep: [15, 11, 9],
      bannerFg: [233, 233, 234],
    },
  },
  {
    id: "silver",
    name: "Clean Minimal",
    description: "White space, sharp type, one quiet accent. Nothing extra.",
    defaultMode: "light",
    display: INTER,
    sans: INTER,
    accents: ["#1F1F23", "#3B5BDB", "#0F766E", "#B4531F", "#7C3AED"],
    light: {
      background: hex("#F7F7F8"),
      surface: hex("#FFFFFF"),
      foreground: hex("#111114"),
      card: hex("#FFFFFF"),
      input: hex("#FFFFFF"),
      elevated: hex("#FFFFFF"),
      border: hex("#E4E4E8"),
      muted: hex("#6B6B75"),
      accent: hex("#1F1F23"),
      wash: hex("#ECECEF"),
      destructive: hex("#C0392B"),
      success: hex("#2F855A"),
      banner: hex("#141417"),
      bannerDeep: hex("#0A0A0C"),
      bannerFg: hex("#F5F5F7"),
    },
    dark: {
      background: hex("#0E0E10"),
      surface: hex("#151518"),
      foreground: hex("#F2F2F4"),
      card: hex("#17171A"),
      input: hex("#0A0A0B"),
      elevated: hex("#1C1C20"),
      border: hex("#2A2A30"),
      muted: hex("#9A9AA5"),
      accent: hex("#E8E8EC"),
      wash: hex("#2A2A30"),
      destructive: hex("#F0827A"),
      success: hex("#6FCF97"),
      banner: hex("#18181C"),
      bannerDeep: hex("#0B0B0D"),
      bannerFg: hex("#F2F2F4"),
    },
  },
  {
    id: "crimson",
    name: "Bold Red",
    description: "Charcoal and flash-sheet red, chunky display type. Loud on purpose.",
    defaultMode: "dark",
    display: SYNE,
    sans: INTER,
    accents: ["#E5383B", "#FF6B35", "#F4D35E", "#00A6A6", "#D6336C"],
    dark: {
      background: hex("#0F0D0D"),
      surface: hex("#181515"),
      foreground: hex("#F5EFEA"),
      card: hex("#1A1616"),
      input: hex("#0A0909"),
      elevated: hex("#201B1B"),
      border: hex("#3A2E2D"),
      muted: hex("#AE9F99"),
      accent: hex("#E5383B"),
      destructive: hex("#FF8A80"),
      success: hex("#7BC89A"),
      banner: hex("#1C1010"),
      bannerDeep: hex("#0B0606"),
      bannerFg: hex("#F5EFEA"),
    },
    light: {
      background: hex("#F4EFEA"),
      surface: hex("#FAF6F2"),
      foreground: hex("#1A1414"),
      card: hex("#FFFBF7"),
      input: hex("#FFFFFF"),
      elevated: hex("#FFFFFF"),
      border: hex("#E3D6CF"),
      muted: hex("#6E5F59"),
      accent: hex("#C1121F"),
      destructive: hex("#9B2226"),
      success: hex("#2D6A4F"),
      banner: hex("#1C1010"),
      bannerDeep: hex("#0B0606"),
      bannerFg: hex("#F5EFEA"),
    },
  },
  {
    id: "blush",
    name: "Soft Blush",
    description: "Cream, dusty rose and a soft serif. Gentle and modern.",
    defaultMode: "light",
    display: FRAUNCES,
    sans: INTER,
    accents: ["#C0707F", "#B58392", "#9C6B98", "#D08C60", "#7D8F69"],
    light: {
      background: hex("#F8F1EE"),
      surface: hex("#FCF7F5"),
      foreground: hex("#2B1F22"),
      card: hex("#FFFBFA"),
      input: hex("#FFFFFF"),
      elevated: hex("#FFFFFF"),
      border: hex("#EBDAD5"),
      muted: hex("#7E6A6E"),
      accent: hex("#C0707F"),
      destructive: hex("#B23A48"),
      success: hex("#4F7D5B"),
      banner: hex("#3A2629"),
      bannerDeep: hex("#211517"),
      bannerFg: hex("#F8EDEA"),
    },
    dark: {
      background: hex("#1A1315"),
      surface: hex("#22191C"),
      foreground: hex("#F6E9E7"),
      card: hex("#241A1D"),
      input: hex("#120D0E"),
      elevated: hex("#2A1F22"),
      border: hex("#3F2E33"),
      muted: hex("#BFA7AB"),
      accent: hex("#E7A1AE"),
      destructive: hex("#F28B8B"),
      success: hex("#8CC7A1"),
      banner: hex("#2A1C1F"),
      bannerDeep: hex("#150E10"),
      bannerFg: hex("#F6E9E7"),
    },
  },
  {
    id: "sage",
    name: "Sage Studio",
    description: "Linen, sage and forest green. Calm, natural, fine-line energy.",
    defaultMode: "light",
    display: FRAUNCES,
    sans: MONTSERRAT,
    accents: ["#4F6F52", "#6B8F71", "#2F5D62", "#A26B45", "#5C5470"],
    light: {
      background: hex("#EEF0EA"),
      surface: hex("#F5F6F2"),
      foreground: hex("#1C231D"),
      card: hex("#FAFBF8"),
      input: hex("#FFFFFF"),
      elevated: hex("#FFFFFF"),
      border: hex("#D6DCD2"),
      muted: hex("#636D63"),
      accent: hex("#4F6F52"),
      destructive: hex("#A4443C"),
      success: hex("#3D7A4E"),
      banner: hex("#1F2A21"),
      bannerDeep: hex("#111812"),
      bannerFg: hex("#EEF0EA"),
    },
    dark: {
      background: hex("#111512"),
      surface: hex("#181D19"),
      foreground: hex("#E8EDE6"),
      card: hex("#1A201B"),
      input: hex("#0B0E0C"),
      elevated: hex("#1F2620"),
      border: hex("#2E3930"),
      muted: hex("#A2AFA2"),
      accent: hex("#9DBF9E"),
      destructive: hex("#EE8A7E"),
      success: hex("#86C99A"),
      banner: hex("#18211A"),
      bannerDeep: hex("#0B0F0C"),
      bannerFg: hex("#E8EDE6"),
    },
  },
  {
    id: "midnight",
    name: "Midnight Neon",
    description: "Deep navy with an electric edge. Built for the night shift.",
    defaultMode: "dark",
    display: SYNE,
    sans: INTER,
    accents: ["#5B8CFF", "#22D3EE", "#A78BFA", "#F472B6", "#34D399"],
    dark: {
      background: hex("#0A0E1A"),
      surface: hex("#10162A"),
      foreground: hex("#E8ECF8"),
      card: hex("#121A30"),
      input: hex("#070A13"),
      elevated: hex("#172039"),
      border: hex("#243152"),
      muted: hex("#94A0BF"),
      accent: hex("#5B8CFF"),
      alt: hex("#A78BFA"),
      destructive: hex("#FF8A8A"),
      success: hex("#5EE0A0"),
      banner: hex("#0F1730"),
      bannerDeep: hex("#060913"),
      bannerFg: hex("#E8ECF8"),
    },
    light: {
      background: hex("#EEF1F8"),
      surface: hex("#F6F8FC"),
      foreground: hex("#0E1428"),
      card: hex("#FFFFFF"),
      input: hex("#FFFFFF"),
      elevated: hex("#FFFFFF"),
      border: hex("#D5DCEC"),
      muted: hex("#5B6583"),
      accent: hex("#3563E9"),
      alt: hex("#7C5CE0"),
      destructive: hex("#C23B3B"),
      success: hex("#23855B"),
      banner: hex("#0F1730"),
      bannerDeep: hex("#060913"),
      bannerFg: hex("#E8ECF8"),
    },
  },
];

export const DEFAULT_THEME: ThemeId = "noir";

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
}

/* ------------------------------------------------------------------ */
/* Colour maths                                                        */
/* ------------------------------------------------------------------ */

const mix = (a: RGB, b: RGB, amount: number): RGB =>
  a.map((v, i) => Math.round(v + (b[i] - v) * amount)) as RGB;

const luminance = ([r, g, b]: RGB) => {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};

const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Nudge a colour lighter or darker until it reads against the ground. */
function readable(color: RGB, ground: RGB, target = 3.2): RGB {
  let out = color;
  const towards: RGB = luminance(ground) > 0.4 ? [0, 0, 0] : [255, 255, 255];
  for (let i = 0; i < 12 && contrast(out, ground) < target; i++) out = mix(out, towards, 0.12);
  return out;
}

const triple = ([r, g, b]: RGB) => `${r} ${g} ${b}`;

export const isHex = (value: string | null | undefined): value is string =>
  !!value && /^#[0-9a-f]{6}$/i.test(value);

/* ------------------------------------------------------------------ */
/* The variables                                                       */
/* ------------------------------------------------------------------ */

export interface Look {
  theme?: string | null;
  mode?: Mode | null;
  accent?: string | null;
}

export function resolveMode(look: Look): Mode {
  return look.mode === "light" || look.mode === "dark" ? look.mode : getTheme(look.theme).defaultMode;
}

/** Every CSS variable the app reads, for this look. */
export function themeVariables(look: Look): Record<string, string> {
  const theme = getTheme(look.theme);
  const mode = resolveMode(look);
  const p = theme[mode];
  const dark = mode === "dark";

  const accent = readable(isHex(look.accent) ? hex(look.accent) : p.accent, p.background);
  const custom = isHex(look.accent);
  const wash = custom || !p.wash ? mix(accent, p.background, dark ? 0.72 : 0.8) : p.wash;
  const alt = custom || !p.alt ? mix(accent, dark ? [255, 255, 255] : p.foreground, 0.35) : p.alt;
  // Text on a primary button: whichever of ink or paper reads better.
  const onAccent: RGB = contrast(accent, [255, 255, 255]) >= contrast(accent, [18, 16, 14]) ? [255, 255, 255] : [18, 16, 14];
  const bannerAccent = mix(accent, [255, 255, 255], dark ? 0.1 : 0.35);

  const [ar, ag, ab] = accent;
  const [sr, sg, sb] = dark ? [0, 0, 0] : mix(p.foreground, accent, 0.4);

  return {
    "--font-display": theme.display,
    "--font-sans": theme.sans,
    "--c-background": triple(p.background),
    "--c-surface": triple(p.surface),
    "--c-foreground": triple(p.foreground),
    "--c-card": triple(p.card),
    "--c-input": triple(p.input),
    "--c-elevated": triple(p.elevated),
    "--c-border": triple(p.border),
    "--c-muted": triple(p.muted),
    "--c-accent": triple(wash),
    "--c-accent-strong": triple(accent),
    "--c-accent-alt": triple(alt),
    "--c-destructive": triple(p.destructive),
    "--c-success": triple(p.success),
    "--c-primary": triple(accent),
    "--c-primary-foreground": triple(onAccent),
    "--c-banner": triple(p.banner),
    "--c-banner-deep": triple(p.bannerDeep),
    "--c-banner-fg": triple(p.bannerFg),
    "--c-banner-accent": triple(bannerAccent),
    "--shadow-soft": dark
      ? `0 1px 2px rgb(0 0 0 / 0.6), 0 8px 24px -12px rgb(${ar} ${ag} ${ab} / 0.28)`
      : `0 1px 2px rgb(${sr} ${sg} ${sb} / 0.07), 0 8px 24px -12px rgb(${sr} ${sg} ${sb} / 0.18)`,
    "--shadow-lift": dark
      ? `0 2px 6px rgb(0 0 0 / 0.6), 0 20px 46px -18px rgb(${ar} ${ag} ${ab} / 0.32)`
      : `0 2px 4px rgb(${sr} ${sg} ${sb} / 0.09), 0 18px 40px -16px rgb(${sr} ${sg} ${sb} / 0.24)`,
    "--shadow-glow": `0 0 0 1px rgb(${ar} ${ag} ${ab} / 0.45), 0 0 30px -6px rgb(${ar} ${ag} ${ab} / ${dark ? 0.5 : 0.35})`,
    "--shadow-inset": dark
      ? "inset 0 1px 0 rgb(255 255 255 / 0.04), inset 0 0 20px rgb(0 0 0 / 0.6)"
      : "inset 0 1px 2px rgb(26 26 26 / 0.05)",
    "--page-wash": dark
      ? `radial-gradient(60rem 40rem at 12% -10%, rgb(${ar} ${ag} ${ab} / 0.16), transparent 62%), radial-gradient(50rem 34rem at 105% 8%, rgb(${triple(alt)} / 0.08), transparent 64%)`
      : `radial-gradient(60rem 40rem at 12% -10%, rgb(${triple(wash)} / 0.75), transparent 62%), radial-gradient(50rem 34rem at 105% 8%, rgb(${ar} ${ag} ${ab} / 0.1), transparent 62%)`,
    "--glass-bg": triple(dark ? p.card : p.surface),
    "--glass-alpha": dark ? "0.72" : "0.76",
    "--ink-a": triple(accent),
    "--ink-b": triple(alt),
    "--ink-opacity": dark ? "0.16" : "0.2",
  };
}

const CACHE_KEY = "runnit-look";

/**
 * Apply a look to the whole app. The result is also cached on the device so
 * index.html can paint it before React loads — otherwise every refresh would
 * flash the default colours first.
 */
export function applyLook(look: Look) {
  const root = document.documentElement;
  const vars = themeVariables(look);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  const mode = resolveMode(look);
  root.dataset.theme = mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", `rgb(${vars["--c-background"].split(" ").join(",")})`);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ mode, vars }));
  } catch {
    /* private mode — the flash on refresh is the only cost */
  }
}

/** Put the app back to its stylesheet defaults (signed out). */
export function clearLook() {
  const root = document.documentElement;
  for (const name of Object.keys(themeVariables({}))) root.style.removeProperty(name);
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Inline style for a preview box: the look, scoped to one element. */
export function previewStyle(look: Look): CSSProperties {
  const vars = themeVariables(look);
  return {
    ...(vars as unknown as CSSProperties),
    backgroundColor: `rgb(${vars["--c-background"]})`,
    color: `rgb(${vars["--c-foreground"]})`,
    fontFamily: vars["--font-sans"],
  };
}
