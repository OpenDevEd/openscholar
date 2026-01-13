import type { Metadata } from "next";
import { Outfit, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { QuerySyncProvider } from "@/components/query-sync-provider";
import { Toaster } from "@/components/ui/sonner";
import { SidebarProvider } from "@/components/sidebar-provider";
import { FilterSidebarProvider } from "@/components/filter-sidebar-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { cn } from "@/lib/utils";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import ConfigProvider from "@/components/config-provider";

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
  title: "OpenScholar - Academic Paper Search",
  description:
    "Search millions of academic papers and research articles with OpenScholar. Find, explore, and download scholarly content with advanced filtering and citation tools.",
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
                <SidebarProvider>
                  <FilterSidebarProvider>
                    <div className="flex h-screen overflow-hidden">
                      {/* Sidebar */}
                      <AppSidebar />
                      
                      {/* Main Content Area */}
                      <div className="flex-1 flex flex-col min-w-0 min-h-0">
                        {children}
                      </div>
                    </div>
                    <Toaster />
                  </FilterSidebarProvider>
                </SidebarProvider>
              </QuerySyncProvider>
            </NuqsAdapter>
          </ThemeProvider>
        </ConfigProvider>
      </body>
    </html>
  );
}
