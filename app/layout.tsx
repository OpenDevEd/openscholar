import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { QuerySyncProvider } from "@/components/query-sync-provider";
import { Toaster } from "@/components/ui/sonner";
import { ConditionalFooter } from "@/components/ui/conditional-footer";
import { cn } from "@/lib/utils";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import ConfigProvider from "@/components/config-provider";
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/nextjs";
import { shadcn } from "@clerk/themes";
import StoreProvider from "./providers/store-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
    <ClerkProvider
      appearance={{
        theme: shadcn,
      }}
    >
      <html lang="en" suppressHydrationWarning>
        <body
          className={cn(geistSans.variable, geistMono.variable, "antialiased")}
        >
          <ConfigProvider>
            <ThemeProvider>
              <NuqsAdapter>
                <QuerySyncProvider>
                  <StoreProvider>
                    <div className="min-h-screen flex flex-col">
                      <div className="flex-1">{children}</div>
                      <ConditionalFooter />
                    </div>
                    <Toaster />
                  </StoreProvider>
                </QuerySyncProvider>
              </NuqsAdapter>
            </ThemeProvider>
          </ConfigProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
