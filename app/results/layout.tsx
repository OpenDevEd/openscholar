"use client";

import React, { Suspense } from "react";
import { SearchProvider, SearchInitializer } from "@/lib/search";
import { PageWrapper } from "@/components/PageWrapper";

interface ResultsLayoutProps {
  children: React.ReactNode;
}

export default function ResultsLayout({ children }: ResultsLayoutProps) {
  return (
    <Suspense
      fallback={
        <PageWrapper>
          <div className="bg-background min-h-screen flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
          </div>
        </PageWrapper>
      }
    >
      <SearchInitializer>
        <SearchProvider>
          <PageWrapper removeOverflow={true}>
            {children}
          </PageWrapper>
        </SearchProvider>
      </SearchInitializer>
    </Suspense>
  );
}
