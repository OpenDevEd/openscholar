"use server";

import { cookies } from "next/headers";
import { locales, defaultLocale, type Locale } from "./config";

const COOKIE_NAME = "NEXT_LOCALE";
const ONE_YEAR = 60 * 60 * 24 * 365;

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  return raw && locales.includes(raw as Locale)
    ? (raw as Locale)
    : defaultLocale;
}

export async function setLocale(locale: Locale): Promise<void> {
  if (!locales.includes(locale)) {
    throw new Error(`Invalid locale: ${locale}`);
  }
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, locale, {
    maxAge: ONE_YEAR,
    path: "/",
    sameSite: "lax",
  });
}
