import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
import { clerkMiddleware, type ClerkMiddlewareAuth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { inFlow, isPage, SETUP_DONE_COOKIE, SETUP_HEADER, SETUP_PATH } from "@/lib/profile/setup";
import { locales } from "@/i18n/config";
import { detectLocaleFromAcceptLanguage } from "@/i18n/locale-detection";
import { languageFromLink } from "@/i18n/link-language";
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
    // Only this proxy says a page is the profile setup.
    headers.delete(SETUP_HEADER);
    const setup = await profileSetup(auth, request);
    if (setup.due) {
      // The page asked for is never rendered, so none of its code runs; the address stays as it is.
      headers.set(SETUP_HEADER, "due");
      return NextResponse.rewrite(new URL(SETUP_PATH, request.url), { request: { headers } });
    }
    const response = NextResponse.next({ request: { headers } });
    if (setup.doneFor) response.cookies.set(SETUP_DONE_COOKIE, setup.doneFor, { maxAge: ONE_YEAR, path: "/", sameSite: "lax", httpOnly: true });
    return response;
  },
  {
    // The session's active organization follows the address (#651): an organization's pages sit
    // under /o/<slug>, every other page is the person's own. Convex reads its own memberships.
    organizationSyncOptions: { organizationPatterns: ["/o/:slug", "/o/:slug/(.*)"], personalAccountPatterns: ["/(.*)"] },
  },
);

/**
 * Whether a page request is a new account's profile setup instead (convex/users/profileSetup.ts). Asked of Convex once
 * per account and browser: an account found done is kept in a cookie, `doneFor`. Never for a request inside a flow
 * (signing in, an app's request, an invitation, a hand-off), a server action, a file or route that isn't a page
 * (`isPage`) or a request that isn't a GET: the setup comes on the next page.
 * An answer that can't be had lets the page through: the setup must never stand in the way of the site.
 */
async function profileSetup(auth: ClerkMiddlewareAuth, request: NextRequest): Promise<{ due: boolean; doneFor?: string }> {
  const path = request.nextUrl.pathname;
  if (request.method !== "GET" || request.headers.has("next-action") || !isPage(path) || path === SETUP_PATH || inFlow(path)) return { due: false };
  const { userId, getToken } = await auth();
  if (!userId || request.cookies.get(SETUP_DONE_COOKIE)?.value === userId) return { due: false };
  try {
    const token = await getToken({ template: "convex" });
    if (!token) return { due: false };
    return (await fetchQuery(api.users.profileSetup.due, {}, { token })) ? { due: true } : { due: false, doneFor: userId };
  } catch (error) {
    console.error(JSON.stringify({ event: "profile-setup-due-failed", error: String(error).slice(0, 300) }));
    return { due: false };
  }
}

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

  // A link from a community site names the language its reader chose (`?hl=fr`): someone with no language here yet
  // starts in that one, and the address drops it. A language they already have here stays theirs.
  const linked = languageFromLink(request.nextUrl, hasValidLocaleCookie(request));
  if (linked) {
    const redirect = NextResponse.redirect(linked.clean);
    if (linked.locale) redirect.cookies.set(COOKIE_NAME, linked.locale, { maxAge: ONE_YEAR, path: "/", sameSite: "lax" });
    return redirect;
  }

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
