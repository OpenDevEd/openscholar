import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { locales, defaultLocale, type Locale } from "./config";

export { locales, defaultLocale };
export type { Locale };

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: Locale =
    raw && locales.includes(raw as Locale) ? (raw as Locale) : defaultLocale;

  let messages: Record<string, unknown>;
  try {
    messages = (await import(`../messages/${locale}.json`)).default;
  } catch {
    messages = (await import("../messages/en-US.json")).default;
  }

  return {
    locale,
    messages,
    getMessageFallback({ namespace, key }) {
      return `${namespace}.${key}`;
    },
  };
});
