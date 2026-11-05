import type { LocalizationResource } from "@clerk/nextjs/types";
import type { Locale } from "@/i18n/config";

/**
 * Clerk's sign-in, sign-up and account screens in the site's language. Clerk's own packs leave much of these screens
 * in English and have no Swahili, Afrikaans or Zulu, so each language keeps a whole file here. US English is Clerk's
 * default, so its file only holds the lines that name the app, which spell it as the brand does. Read on the server
 * so a page carries only its own language.
 */
export async function clerkLocalizationFor(locale: string): Promise<LocalizationResource> {
  const file = await import(`./clerk-localization/${locale as Locale}.json`);
  return file.default as LocalizationResource;
}
