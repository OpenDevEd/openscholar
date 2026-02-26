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
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { ConsentAwareGoogleAnalytics } from "@/components/google-analytics";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://openscholar.ai"),
  title: "OpenScholar - Academic Paper Search",
  description:
    "Search millions of academic papers and research articles with OpenScholar. Find, explore, and download scholarly content with advanced filtering and citation tools.",
  appleWebApp: {
    title: "OpenScholar.ai",
  },
  openGraph: {
    title: "OpenScholar - Academic Paper Search",
    description:
      "Search millions of academic papers and research articles with OpenScholar. Find, explore, and download scholarly content with advanced filtering and citation tools.",
    url: "https://openscholar.ai",
    siteName: "OpenScholar",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenScholar - Academic Paper Search",
    description:
      "Search millions of academic papers and research articles with OpenScholar. Find, explore, and download scholarly content with advanced filtering and citation tools.",
    creator: "@OpenScholarAI",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={cn(outfit.variable, geistMono.variable, "antialiased")}>
      <body>
        <ConfigProvider>
          <ThemeProvider>
            <NuqsAdapter>
              <QuerySyncProvider>
                <div className="flex min-h-screen">
                  {/* Sidebar */}
                  <AppSidebar />
                  
                  {/* Main Content Area */}
                  <div className="flex-1 flex flex-col min-w-0 min-h-0">
                    {/* Mobile Navbar */}
                    <MobileNavbar />
                    
                    {children}
                  </div>
                </div>
                <Toaster />
                <CookieConsentBanner />
                <ConsentAwareGoogleAnalytics />
              </QuerySyncProvider>
            </NuqsAdapter>
          </ThemeProvider>
        </ConfigProvider>
      </body>
    </html>
  );
}
