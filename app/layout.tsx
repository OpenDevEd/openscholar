import type { Metadata } from "next";
import { Ubuntu } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { QuerySyncProvider } from "@/components/query-sync-provider";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmationHost } from "@/lib/confirmation";
import { AppSidebar } from "@/components/app-sidebar";
import { sidebarWidthScript } from "@/lib/sidebar-width";
import { MobileNavbar } from "@/components/mobile-navbar";
import { cn } from "@/lib/utils";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import ConfigProvider from "@/components/config-provider";
import { ConvexClientProvider } from "@/components/providers/convex-provider";
import { AuthRouteGate } from "@/components/auth/auth-route-gate";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { ConsentAwareGoogleAnalytics } from "@/components/google-analytics";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { preloadQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

// The brand typeface. To change it, swap the family here; --font-app feeds
// --font-sans in globals.css.
const appFont = Ubuntu({
  variable: "--font-app",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");

  return {
    metadataBase: new URL(t("siteUrl")),
    title: t("defaultTitle"),
    description: t("defaultDescription"),
    appleWebApp: {
      title: t("siteName"),
    },
    openGraph: {
      title: t("defaultTitle"),
      description: t("defaultDescription"),
      url: t("siteUrl"),
      siteName: t("siteName"),
      locale: t("locale"),
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: t("defaultTitle"),
      description: t("defaultDescription"),
      creator: t("twitterCreator"),
    },
    robots: {
      index: true,
      follow: true,
    },
    alternates: {
      canonical: "/",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, messages, preloadedFlags, preloadedCatalog] = await Promise.all([
    getLocale(),
    getMessages(),
    preloadQuery(api.featureFlags.queries.list),
    preloadQuery(api.billing.catalog.get),
  ]);

  return (
    <html lang={locale} suppressHydrationWarning className={cn(appFont.variable, "antialiased")}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: sidebarWidthScript }} />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <ConvexClientProvider preloadedFlags={preloadedFlags} preloadedCatalog={preloadedCatalog}>
              <ConfigProvider>
                <NuqsAdapter>
                  <QuerySyncProvider>
                    <TooltipProvider>
                      <div className="flex min-h-screen">
                        {/* Sidebar */}
                        <AppSidebar />

                        {/* Main Content Area */}
                        <div className="flex-1 flex flex-col min-w-0 min-h-0 [--app-navbar-height:3.5rem] md:[--app-navbar-height:0px]">
                          {/* Mobile Navbar */}
                          <MobileNavbar />

                          <AuthRouteGate>{children}</AuthRouteGate>
                        </div>
                      </div>
                      <Toaster />
                      <ConfirmationHost />
                      <CookieConsentBanner />
                      <ConsentAwareGoogleAnalytics />
                    </TooltipProvider>
                  </QuerySyncProvider>
                </NuqsAdapter>
              </ConfigProvider>
            </ConvexClientProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
