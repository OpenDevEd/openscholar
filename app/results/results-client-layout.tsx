"use client";

import React, { Suspense, useContext } from "react";
import { useParams } from "next/navigation";
import { SearchProvider, SearchInitializer } from "@/lib/search";
import { ResearchLoading } from "@/lib/research/provider";
import { ResearchContext } from "@/lib/research/binding";
import { useSearchHistoryStore } from "@/lib/store";

function InitializeResults({ children }: { children: React.ReactNode }) {
  const account = useContext(ResearchContext);
  const { searchId } = useParams<{ searchId?: string }>();
  const saved = useSearchHistoryStore(state => state.searchHistory.some(search => search.id === searchId));
  // An existing account record owns its state. A stale URL must not overwrite it.
  return account && saved ? children : <SearchInitializer>{children}</SearchInitializer>;
}

export function ResultsClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="bg-background min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
        </div>
      }
    >
      <ResearchLoading><InitializeResults>
        <SearchProvider>
          {children}
        </SearchProvider>
      </InitializeResults></ResearchLoading>
    </Suspense>
  );
}
