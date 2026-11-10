import type { Metadata } from "next";
import { Suspense } from "react";
import { QUESTION_STAGE_SCRIPT } from "@/lib/search/question-stage-script";
import { Ubuntu } from "next/font/google";
import { DirectionProvider } from "@/components/ui/direction";
import { isRightToLeft } from "@/lib/i18n/locale-map";
import { clerkLocalizationFor } from "@/lib/auth/clerk-localization";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { QuerySyncProvider } from "@/components/query-sync-provider";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmationHost } from "@/lib/confirmation";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileNavbar } from "@/components/mobile-navbar";
import { AlphaStrip } from "@/components/alpha-notices";
import { cn } from "@/lib/utils";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import ConfigProvider from "@/components/config-provider";
import { ConvexClientProvider } from "@/components/providers/convex-provider";
import { AuthRouteGate } from "@/components/auth/auth-route-gate";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProfileSetupGate } from "@/components/onboarding/profile-setup";
import { setupDue } from "@/lib/onboarding-mock/store";
import { inFlow } from "@/lib/onboarding-mock/types";
import { ADDRESS_HEADER } from "@/lib/workspaces/paths";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { ConsentAwareGoogleAnalytics } from "@/components/google-analytics";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { preloadQuery } from "convex/nextjs";
import { cookies, headers } from "next/headers";
import { auth, currentUser } from "@clerk/nextjs/server";
import { LOOK_COOKIE, lookKey, readCache, WORKSPACE_HEADER } from "@/lib/workspaces/look-cache";
import { AssistantPanel } from "@/components/assistant/panel";
import { ItemHome, WorkspaceGone } from "@/components/workspaces/item-home";
import { WorkspacesProvider } from "@/components/workspaces/parts";
import { QueryHighlightProvider } from "@/components/query-highlight";
import { QUERY_HIGHLIGHT_COOKIE } from "@/lib/search/boolean-query";
import { api } from "@/convex/_generated/api";
import { previewDefaults, SITE_URL } from "@/lib/seo/page-metadata";

// The brand typeface. To change it, swap the family here; --font-app feeds
// --font-sans in globals.css.
const appFont = Ubuntu({
  variable: "--font-app",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const [t, defaults] = await Promise.all([getTranslations("metadata"), previewDefaults()]);

  return {
    metadataBase: new URL(SITE_URL),
    title: { default: t("defaultTitle"), template: `%s | ${t("siteName")}` },
    description: t("defaultDescription"),
    appleWebApp: {
      title: t("siteName"),
    },
    openGraph: { ...defaults.openGraph, title: t("defaultTitle"), description: t("defaultDescription") },
    twitter: { ...defaults.twitter, title: t("defaultTitle"), description: t("defaultDescription") },
    // Out of search engines unless a page says otherwise (lib/seo/page-metadata.ts).
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, messages, preloadedFlags, preloadedCatalog, { userId }, requestHeaders, requestCookies] = await Promise.all([
    getLocale(),
    getMessages(),
    preloadQuery(api.featureFlags.queries.list),
    preloadQuery(api.billing.catalog.get),
    auth(),
    headers(),
    cookies(),
  ]);
  // The rail as this browser last saw it, drawn from the first frame: the person and the address's workspace. None signed out.
  const slug = requestHeaders.get(WORKSPACE_HEADER) || null;
  const { me, looks } = readCache(requestCookies.get(LOOK_COOKIE)?.value, userId);
  const look = looks[lookKey(slug)];
  // MOCK (mock/onboarding): whether this page is the profile setup, decided before anything is drawn.
  const address = (requestHeaders.get(ADDRESS_HEADER) ?? "/").split("?")[0]!;
  const setupFirst = userId && !inFlow(address) ? await setupDue(userId) : false;
  const setupUser = setupFirst ? await currentUser() : null;
  const setupPerson = setupUser ? { name: setupUser.fullName ?? "", imageUrl: setupUser.imageUrl } : null;

  const clerkLocalization = await clerkLocalizationFor(locale);
  const direction = isRightToLeft(locale) ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={direction} suppressHydrationWarning className={cn(appFont.variable, "antialiased")}>
      <head>
        {/* In the head: a browser only lets a script hold back the first paint while the body hasn't started. */}
        {/* eslint-disable-next-line react/no-danger -- has to run before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: QUESTION_STAGE_SCRIPT }} />
      </head>
      <body>
        <DirectionProvider dir={direction}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <ConvexClientProvider preloadedFlags={preloadedFlags} preloadedCatalog={preloadedCatalog} clerkLocalization={clerkLocalization}>
              <ConfigProvider>
                <NuqsAdapter>
                  <QuerySyncProvider>
                    <TooltipProvider>
                      <WorkspacesProvider>
                        <QueryHighlightProvider initial={requestCookies.get(QUERY_HIGHLIGHT_COOKIE)?.value !== "off"}>
                          {/* MOCK (mock/onboarding): while a new account's profile setup is due, it is the whole page. */}
                          <ProfileSetupGate due={setupFirst} person={setupPerson}>
                          <div className="flex min-h-screen">
                            {/* Sidebar */}
                            <AppSidebar firstWorkspace={{ slug, ...(userId ? { user: userId } : {}), ...(me ? { me } : {}), ...(look ? { look } : {}) }} />

                            {/* Main Content Area */}
                            <div className="flex-1 flex flex-col min-w-0 min-h-0 [--app-navbar-height:5.5rem] md:[--app-navbar-height:2rem]">
                              <AlphaStrip />
                              {/* Mobile Navbar */}
                              <MobileNavbar />

                              {/* MOCK (mock/onboarding): the page isn't rendered at all while the setup stands in front of it. */}
                              <AuthRouteGate>{setupFirst ? null : children}</AuthRouteGate>
                            </div>
                          </div>
                          <Toaster />
                          <ConfirmationHost />
                          {/* A link to an item in another of the person's workspaces opens there (#651), and a page of an organization they're no longer in gives way to their own. */}
                          <Suspense fallback={null}>
                            <ItemHome />
                            <WorkspaceGone />
                          </Suspense>
                          <AssistantPanel />
                          <CookieConsentBanner />
                          <ConsentAwareGoogleAnalytics />
                          </ProfileSetupGate>
                        </QueryHighlightProvider>
                      </WorkspacesProvider>
                    </TooltipProvider>
                  </QuerySyncProvider>
                </NuqsAdapter>
              </ConfigProvider>
            </ConvexClientProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
