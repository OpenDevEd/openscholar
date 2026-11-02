import { arSA, deDE, enGB, enUS, esES, frFR, hiIN, jaJP, ptPT, zhCN } from "@clerk/localizations";
import { dark } from "@clerk/ui/themes";
import type { LocalizationResource } from "@clerk/nextjs/types";
import type { Appearance } from "@clerk/ui";

// Clerk's own screens take their colours and typeface from the app's tokens,
// so they follow the active theme.
const variables = {
  colorPrimary: "var(--primary)",
  colorPrimaryForeground: "var(--primary-foreground)",
  colorBackground: "var(--card)",
  colorForeground: "var(--foreground)",
  colorMutedForeground: "var(--muted-foreground)",
  colorInput: "var(--background)",
  colorInputForeground: "var(--foreground)",
  colorNeutral: "var(--foreground)",
  colorDanger: "var(--destructive)",
  fontFamily: "var(--font-sans)",
} satisfies NonNullable<Appearance["variables"]>;

const CLERK_LOCALIZATION_BY_LOCALE: Record<string, LocalizationResource> = {
  "en-us": enUS,
  "en-gb": enGB,
  zh: zhCN,
  "zh-cn": zhCN,
  fr: frFR,
  "fr-fr": frFR,
  hi: hiIN,
  "hi-in": hiIN,
  ja: jaJP,
  ar: arSA,
  de: deDE,
  es: esES,
  pt: ptPT,
  "ja-jp": jaJP,
};

function normalizeLocale(locale: string | null | undefined): string {
  return (locale ?? "en-US").trim().replace("_", "-").toLowerCase();
}

export function resolveClerkLocalization(
  locale: string | null | undefined,
): LocalizationResource {
  const normalized = normalizeLocale(locale);
  const exact = CLERK_LOCALIZATION_BY_LOCALE[normalized];
  if (exact) {
    return exact;
  }

  const language = normalized.split("-")[0] ?? "en";
  return CLERK_LOCALIZATION_BY_LOCALE[language] ?? enUS;
}

export function resolveClerkAppearance(
  resolvedTheme: string | null | undefined,
): Appearance {
  // The mark as the brand guidelines draw it on white and on black. Sign-up keeps
  // offering the optional first and last name, which other members see.
  return resolvedTheme === "dark"
    ? { theme: dark, variables, options: { logoImageUrl: "/icon-black.svg", showOptionalFields: true } }
    : { variables, options: { logoImageUrl: "/icon.svg", showOptionalFields: true } };
}
