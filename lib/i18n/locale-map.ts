/**
 * Map next-intl locale identifiers to BCP 47 language tags
 * for use with Intl APIs (DisplayNames, NumberFormat, etc.)
 */
export const NEXT_INTL_TO_BCP47: Record<string, string> = {
  "zh": "zh-CN",
  "hi": "hi-IN",
  "en-US": "en-US",
  "en-GB": "en-GB",
  "fr": "fr-FR",
};

/**
 * Get BCP 47 locale for Intl APIs from next-intl locale
 */
export function toBcp47Locale(nextIntlLocale: string): string {
  return NEXT_INTL_TO_BCP47[nextIntlLocale] ?? nextIntlLocale;
}
