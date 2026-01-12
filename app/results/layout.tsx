"use client";

import React, { Suspense } from "react";
import { SearchProvider, SearchInitializer } from "@/lib/search";

interface ResultsLayoutProps {
  children: React.ReactNode;
}

export default function ResultsLayout({ children }: ResultsLayoutProps) {
  return (
    <Suspense
      fallback={
        <div className="bg-background min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
        </div>
      }
    >
      <SearchInitializer>
        <SearchProvider>
          {children}
        </SearchProvider>
      </SearchInitializer>
    </Suspense>
  );
}
