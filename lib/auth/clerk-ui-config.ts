import { enGB, enUS, frFR, hiIN, jaJP, zhCN } from "@clerk/localizations";
import { dark } from "@clerk/themes";
import type { Appearance, LocalizationResource } from "@clerk/types";

// Clerk's own screens take their colours and typeface from the app's tokens,
// so they follow whichever theme is active.
const variables = {
  colorPrimary: "var(--primary)",
  colorTextOnPrimaryBackground: "var(--primary-foreground)",
  colorBackground: "var(--card)",
  colorText: "var(--foreground)",
  colorTextSecondary: "var(--muted-foreground)",
  colorInputBackground: "var(--background)",
  colorInputText: "var(--foreground)",
  colorNeutral: "var(--foreground)",
  colorDanger: "var(--destructive)",
  fontFamily: "var(--font-sans)",
};
// The mark as the brand guidelines draw it on each background. White and navy
// share one file.
const LOGO_BY_THEME: Record<string, string> = {
  dark: "/icon-black.svg",
  blue: "/icon-white.svg",
};

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
  const layout = { logoImageUrl: LOGO_BY_THEME[resolvedTheme ?? ""] ?? "/icon.svg" };
  // Navy, black and blue are all dark schemes.
  return resolvedTheme && resolvedTheme !== "light"
    ? { theme: dark, variables, layout }
    : { variables, layout };
}
