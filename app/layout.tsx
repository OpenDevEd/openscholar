import type { Metadata } from "next";
import { Outfit, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { QuerySyncProvider } from "@/components/query-sync-provider";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileNavbar } from "@/components/mobile-navbar";
import { cn } from "@/lib/utils";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import ConfigProvider from "@/components/config-provider";
import { ConvexClientProvider } from "@/components/providers/convex-provider";
import { AuthRouteGate } from "@/components/auth/auth-route-gate";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning className={cn(outfit.variable, geistMono.variable, "antialiased")}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ConvexClientProvider>
            <ConfigProvider>
              <ThemeProvider>
                <NuqsAdapter>
                  <QuerySyncProvider>
                    <TooltipProvider>
                      <div className="flex min-h-screen">
                        {/* Sidebar */}
                        <AppSidebar />

                        {/* Main Content Area */}
                        <div className="flex-1 flex flex-col min-w-0 min-h-0">
                          {/* Mobile Navbar */}
                          <MobileNavbar />

                          <AuthRouteGate>{children}</AuthRouteGate>
                        </div>
                      </div>
                      <Toaster />
                    </TooltipProvider>
                  </QuerySyncProvider>
                </NuqsAdapter>
              </ThemeProvider>
            </ConfigProvider>
          </ConvexClientProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
