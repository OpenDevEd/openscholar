"use client";

import React, { Suspense } from "react";
import { Navbar } from "@/components/navbar";
import { useUIStore } from "@/lib/store";
import { SearchProvider, SearchInitializer } from "@/lib/search";

interface ResultsLayoutProps {
  children: React.ReactNode;
}

function ResultsLayoutContent({ children }: ResultsLayoutProps) {
  const { loadingResultIndex } = useUIStore();

  return (
    <div className="bg-background">
      <Navbar loadingResultIndex={loadingResultIndex} />
      {children}
    </div>
  );
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
          <ResultsLayoutContent>{children}</ResultsLayoutContent>
        </SearchProvider>
      </SearchInitializer>
    </Suspense>
  );
}
