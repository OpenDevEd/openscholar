import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { locales } from "@/i18n/config";
import { detectLocaleFromAcceptLanguage } from "@/i18n/locale-detection";
import { shouldProtectPath } from "@/lib/auth/proxy-policy";
import { bareWorkLink } from "@/lib/search-params/bare-work-link";
import { slugOf, WORKSPACE_HEADER } from "@/lib/workspaces/look-cache";
import { ADDRESS_HEADER } from "@/lib/workspaces/paths";
import { CITATION_FILES, type CitationFile } from "@/lib/citations/formats";
import { citeFilePath } from "@/lib/papers/page-address";

const COOKIE_NAME = "NEXT_LOCALE";
const ONE_YEAR = 60 * 60 * 24 * 365;

const authMiddleware = clerkMiddleware(
  async (auth, request) => {
    if (shouldProtectPath(request.nextUrl.pathname)) {
      await auth.protect();
    }
    // The workspace the address is in, for the root layout, which gets no route params: it draws
    // the rail as that workspace looked last time (lib/workspaces/look-cache.ts).
    const headers = new Headers(request.headers);
    headers.set(WORKSPACE_HEADER, slugOf(request.nextUrl.pathname) ?? "");
    // And the address itself, for an organization's layout to send someone outside it to the same page in their own workspace.
    headers.set(ADDRESS_HEADER, request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.next({ request: { headers } });
  },
  {
    // The session's active organization follows the address (#651): an organization's pages sit
    // under /o/<slug>, every other page is the person's own. Convex reads its own memberships.
    organizationSyncOptions: { organizationPatterns: ["/o/:slug", "/o/:slug/(.*)"], personalAccountPatterns: ["/(.*)"] },
  },
);

function hasValidLocaleCookie(request: NextRequest): boolean {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  return !!raw && locales.includes(raw as (typeof locales)[number]);
}

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent
) {
  const bareLink = bareWorkLink(request.nextUrl);
  if (bareLink) return NextResponse.redirect(bareLink);
  // Our index names each record by an address, openscholar.ai/OS…, which reaches here: it's that paper's page.
  const ownRecord = /^\/(OS\d+)$/i.exec(request.nextUrl.pathname)?.[1];
  if (ownRecord) return NextResponse.redirect(new URL(`/papers/${ownRecord.toUpperCase()}`, request.url), 308);

  const needsLocaleCookie = !hasValidLocaleCookie(request);
  const detectedLocale = needsLocaleCookie
    ? detectLocaleFromAcceptLanguage(request.headers.get("accept-language"))
    : null;

  const authResponse = await authMiddleware(request, event);
  const response = authResponse ?? NextResponse.next();

  // A paper page says, in its headers, where its citation files are and what it is (signposting.org), for tools that read headers, not pages.
  const paperPage = /^\/papers\/((?:OS|W)\d+)(?:\/[^/.]*)?$/i.exec(request.nextUrl.pathname)?.[1];
  if (paperPage) response.headers.append("Link", [
    ...(Object.keys(CITATION_FILES) as CitationFile[]).map((kind) => `<${citeFilePath(paperPage.toUpperCase(), kind)}>; rel="describedby"; type="${CITATION_FILES[kind].type}"`),
    '<https://schema.org/ScholarlyArticle>; rel="type"',
  ].join(", "));

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
