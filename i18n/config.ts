export const locales = ["en-US", "en-GB", "zh", "fr", "hi", "ja", "ar", "sw", "pt", "es", "de", "af"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en-US";
