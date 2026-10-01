export type ArtMode = "theme" | "gold" | "mono" | "off";
export const ART_MODES: ArtMode[] = ["theme", "gold", "mono", "off"];

/** Put the studio's illustration style on <html data-art>, where index.css
 * reads it. Anything unknown, or nothing saved, means "theme". */
export function applyArt(mode: string | null | undefined) {
  document.documentElement.dataset.art = ART_MODES.includes(mode as ArtMode) ? (mode as ArtMode) : "theme";
}
