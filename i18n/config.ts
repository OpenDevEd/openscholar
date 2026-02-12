export const locales = ["en-US", "en-GB", "zh", "fr", "hi"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en-US";
