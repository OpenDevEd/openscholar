import { match } from "@formatjs/intl-localematcher";
import { locales, defaultLocale, type Locale } from "./config";

/**
 * Parse Accept-Language header into ordered locale list.
 * Format: "en-US,en;q=0.9,zh;q=0.8" -> ["en-US", "en", "zh"]
 * Filters out "*" (wildcard) and invalid entries.
 */
function parseAcceptLanguage(header: string | null): string[] {
  if (!header?.trim()) return [];

  return header
    .split(",")
    .map((part) => {
      const [localePart, qPart] = part.trim().split(";").map((s) => s.trim());
      const rawQ = qPart?.startsWith("q=") ? parseFloat(qPart.slice(2)) : 1;
      const q = Number.isNaN(rawQ) ? 0 : Math.max(0, Math.min(1, rawQ));
      return { locale: localePart?.trim() ?? "", q };
    })
    .filter((x) => x.locale && x.locale !== "*")
    .sort((a, b) => b.q - a.q)
    .map((x) => x.locale);
}

/**
 * Detect locale from Accept-Language header using best-fit matching.
 * Uses @formatjs/intl-localematcher (same as next-intl middleware).
 */
export function detectLocaleFromAcceptLanguage(
  header: string | null
): Locale {
  const requested = parseAcceptLanguage(header);
  if (requested.length === 0) return defaultLocale;

  const orderedLocales = [...locales].sort((a, b) => b.length - a.length);
  const matched = match(requested, orderedLocales, defaultLocale);

  const locale = locales.find(
    (l) => l.toLowerCase() === matched.toLowerCase()
  ) as Locale | undefined;
  return locale ?? defaultLocale;
}
