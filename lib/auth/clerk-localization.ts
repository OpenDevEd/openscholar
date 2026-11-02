import type { LocalizationResource } from "@clerk/nextjs/types";
import type { Locale } from "@/i18n/config";

/**
 * Clerk's sign-in, sign-up and account screens in the site's language. Clerk's own packs leave much of these screens
 * in English and have no Swahili, Afrikaans or Zulu, so each language keeps a whole file here. Read on the server so
 * a page carries only its own language. US English is Clerk's default.
 */
export async function clerkLocalizationFor(locale: string): Promise<LocalizationResource | undefined> {
  if (locale === "en-US") return undefined;
  const file = await import(`./clerk-localization/${locale as Exclude<Locale, "en-US">}.json`);
  return file.default as LocalizationResource;
}
