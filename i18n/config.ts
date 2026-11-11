export const locales = ["en-US", "en-GB", "zh", "fr", "hi", "ja", "ar", "sw", "pt", "es", "de", "af", "zu"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en-US";

/** Each language in its own name, as its readers know it: someone who can't read the page's language still finds theirs. */
export const localeNames: Record<Locale, string> = {
  "en-US": "English (US)",
  "en-GB": "English (UK)",
  zh: "中文",
  fr: "Français",
  hi: "हिंदी",
  ja: "日本語",
  ar: "العربية",
  sw: "Kiswahili",
  pt: "Português",
  es: "Español",
  de: "Deutsch",
  af: "Afrikaans",
  zu: "IsiZulu",
};
