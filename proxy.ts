import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { locales } from "@/i18n/config";
import { detectLocaleFromAcceptLanguage } from "@/i18n/locale-detection";
import { shouldProtectPath } from "@/lib/auth/proxy-policy";

const COOKIE_NAME = "NEXT_LOCALE";
const ONE_YEAR = 60 * 60 * 24 * 365;

const authMiddleware = clerkMiddleware(async (auth, request) => {
  if (shouldProtectPath(request.nextUrl.pathname)) {
    await auth.protect();
  }
});

function hasValidLocaleCookie(request: NextRequest): boolean {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  return !!raw && locales.includes(raw as (typeof locales)[number]);
}

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent
) {
  const needsLocaleCookie = !hasValidLocaleCookie(request);
  const detectedLocale = needsLocaleCookie
    ? detectLocaleFromAcceptLanguage(request.headers.get("accept-language"))
    : null;

  const authResponse = await authMiddleware(request, event);
  const response = authResponse ?? NextResponse.next();

  if (needsLocaleCookie && detectedLocale) {
    const cookieValue = `${COOKIE_NAME}=${encodeURIComponent(detectedLocale)}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
    if (response instanceof NextResponse) {
      response.cookies.set(COOKIE_NAME, detectedLocale, {
        maxAge: ONE_YEAR,
        path: "/",
        sameSite: "lax",
      });
    } else {
      response.headers.append("Set-Cookie", cookieValue);
    }
  }

  return response;
}

export const config = {
  // Clerk-recommended matcher shape:
  // 1) Skip Next internals + static files.
  // 2) Always run middleware for API/TRPC routes.
  matcher: [
    "/((?!_next|citation-styles/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
