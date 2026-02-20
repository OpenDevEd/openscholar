import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { PUBLIC_UNAUTHENTICATED_PATHS } from "@/lib/auth/public-routes";
import { locales } from "@/i18n/config";
import { detectLocaleFromAcceptLanguage } from "@/i18n/locale-detection";

const COOKIE_NAME = "NEXT_LOCALE";
const ONE_YEAR = 60 * 60 * 24 * 365;

const authMiddleware = authkitMiddleware({
  redirectUri:
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ??
    process.env.WORKOS_REDIRECT_URI!,
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [...PUBLIC_UNAUTHENTICATED_PATHS],
  },
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

  const response = await authMiddleware(request, event);

  if (response && needsLocaleCookie && detectedLocale) {
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

// Match all paths except API routes, Next internals, and static assets.
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)",
  ],
};
