import { HEX_COLOUR, THEME_DEFAULTS, type ThemeDraft } from "@/lib/evidence-libraries/configuration/rules";

export type ColourPresetKey =
  | "sunrise"
  | "forest"
  | "ocean"
  | "violet"
  | "rose"
  | "slate"
  | "amber"
  | "teal";

/** `key` is the translation key under `evidenceLibraryConfiguration.theme.presets`. */
export const COLOUR_PRESETS: {
  key: ColourPresetKey;
  colors: ThemeDraft["colors"];
}[] = [
  { key: "sunrise", colors: { ...THEME_DEFAULTS.colors, accent: "#e68124", tertiary: "#2b4c7e", link: "#c2410c" } },
  { key: "forest", colors: { ...THEME_DEFAULTS.colors, accent: "#1d9a6c", tertiary: "#0f3d3e", link: "#047857" } },
  { key: "ocean", colors: { ...THEME_DEFAULTS.colors, accent: "#2563eb", tertiary: "#1e293b", link: "#1d4ed8" } },
  { key: "violet", colors: { ...THEME_DEFAULTS.colors, accent: "#7c3aed", tertiary: "#3b0764", link: "#6d28d9" } },
  { key: "rose", colors: { ...THEME_DEFAULTS.colors, accent: "#e11d48", tertiary: "#4c0519", link: "#be123c" } },
  { key: "slate", colors: { ...THEME_DEFAULTS.colors, accent: "#475569", tertiary: "#0f172a", link: "#334155" } },
  { key: "amber", colors: { ...THEME_DEFAULTS.colors, accent: "#d97706", tertiary: "#292524", link: "#b45309" } },
  { key: "teal", colors: { ...THEME_DEFAULTS.colors, accent: "#0d9488", tertiary: "#134e4a", link: "#0f766e" } },
];

/** Relative luminance of the opaque part of a colour, for WCAG contrast. */
function luminance(hex: string) {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string) {
  if (!HEX_COLOUR.test(a) || !HEX_COLOUR.test(b)) return 0;
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
