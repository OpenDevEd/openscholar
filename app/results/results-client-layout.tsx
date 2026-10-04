"use client";

import React, { Suspense, useContext } from "react";
import { usePathname } from "next/navigation";
import { SearchProvider, SearchInitializer } from "@/lib/search";
import { ResearchLoading, useResearchStatus } from "@/lib/research/provider";
import { useWatchedSearch } from "@/lib/research/reads";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { ResearchContext } from "@/lib/research/binding";
import { useSearchHistoryStore } from "@/lib/store";
import { getEffectiveSearchId } from "@/lib/utils";

function InitializeResults({ children }: { children: React.ReactNode }) {
  const account = useContext(ResearchContext);
  const searchId = getEffectiveSearchId(usePathname());
  const watched = useWatchedSearch(account ? searchId : undefined);
  const { retry } = useResearchStatus();
  const saved = useSearchHistoryStore(state => searchId !== undefined && state.getSearchResult(searchId) !== undefined);
  // An existing account record owns its state. A stale URL must not overwrite it, so the
  // page waits to learn whether the account has this search.
  if (account && watched === "failed") return <AuthStatePanel variant="sync_error_retry" onRetry={retry} />;
  if (account && watched === "loading") return <ResultsLoading />;
  return account && saved ? children : <SearchInitializer>{children}</SearchInitializer>;
}

function ResultsLoading() {
  return (
    <div className="bg-background min-h-screen flex items-center justify-center" aria-busy="true">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
    </div>
  );
}

export function ResultsClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={<ResultsLoading />}
    >
      <ResearchLoading><InitializeResults>
        <SearchProvider>
          {children}
        </SearchProvider>
      </InitializeResults></ResearchLoading>
    </Suspense>
  );
}
