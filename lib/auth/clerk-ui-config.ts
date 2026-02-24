import { enGB, enUS, frFR, hiIN, jaJP, zhCN } from "@clerk/localizations";
import { dark } from "@clerk/themes";
import type { Appearance, LocalizationResource } from "@clerk/types";

const CLERK_LIGHT_APPEARANCE: Appearance = {};
const CLERK_DARK_APPEARANCE: Appearance = { theme: dark };

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
  return resolvedTheme === "dark"
    ? CLERK_DARK_APPEARANCE
    : CLERK_LIGHT_APPEARANCE;
}
