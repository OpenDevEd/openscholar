import { locales, type Locale } from "./config";

/**
 * A link from a community site names the language its reader chose there (`?hl=fr`). The address loses it, and
 * someone with no language here yet starts in it (`locale`); a language they already have here stays theirs (null).
 * Null for an address that names none.
 */
export function languageFromLink(url: URL, hasLanguage: boolean): { clean: URL; locale: Locale | null } | null {
  const asked = url.searchParams.get("hl");
  if (asked === null) return null;
  const clean = new URL(url);
  clean.searchParams.delete("hl");
  return { clean, locale: !hasLanguage && locales.includes(asked as Locale) ? (asked as Locale) : null };
}
