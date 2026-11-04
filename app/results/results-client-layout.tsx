"use client";

import React, { Suspense, useContext, useState } from "react";
import { redirect, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { SearchProvider } from "@/lib/search";
import { SearchInitializer } from "@/lib/search/initializer";
import { ResearchLoading, useResearchStatus } from "@/lib/research/provider";
import { useWatchedSearch } from "@/lib/research/reads";
import { AuthStatePanel } from "@/components/auth/auth-state-panel";
import { ResearchContext } from "@/lib/research/binding";
import { useSearchHistoryStore } from "@/lib/store";
import { getEffectiveSearchId } from "@/lib/utils";
import { useItemHome } from "@/components/workspaces/item-home";
import { Gone } from "@/components/workspaces/shared";
import { parseSearchParamsFromUrl, readUrlQuestion } from "@/lib/search-params";
import { carriesSearch } from "@/lib/search/resolve-search-init";
import { useWorkspaceSlug, workspaceHref } from "@/lib/workspaces/href";

function InitializeResults({ children }: { children: React.ReactNode }) {
  const t = useTranslations("searchCommand");
  const account = useContext(ResearchContext);
  const params = useSearchParams();
  const carried = carriesSearch(parseSearchParamsFromUrl(params)) || readUrlQuestion(params) !== "";
  const searchId = getEffectiveSearchId(usePathname());
  const watched = useWatchedSearch(account ? searchId : undefined);
  const { retry } = useResearchStatus();
  const saved = useSearchHistoryStore(state => searchId !== undefined && state.getSearchResult(searchId) !== undefined);
  // A search this workspace doesn't have may be in another of the person's, where ItemHome opens it:
  // nothing is made here until that's known (#651).
  const unknown = account !== null && searchId !== undefined && !saved && watched === "missing";
  const home = useItemHome(unknown ? { kind: "search", id: searchId } : null);
  const slug = useWorkspaceSlug();
  // It also opens under another ID where a link to a shared search carries the one its own workspace knows it by (#653).
  const elsewhere = unknown && (home === undefined || (home !== null && (home.slug !== slug || home.id !== undefined)));
  // The searches this tab has shown. Once one is gone, deleted in another tab or moved where the person
  // can't follow, the tab leaves for search, at once or when Back returns to it: a new one is made only
  // at an address never opened here.
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  if (saved && searchId !== undefined && !shown.has(searchId)) setShown(new Set(shown).add(searchId));
  const gone = account !== null && searchId !== undefined && !saved && shown.has(searchId);
  if (gone && unknown && home === null) redirect(workspaceHref(slug, "/"));
  // An existing account record owns its state. A stale URL must not overwrite it, so the
  // page waits to learn whether the account has this search.
  if (account && watched === "failed") return <AuthStatePanel variant="sync_error_retry" onRetry={retry} />;
  if (account && watched === "loading") return <ResultsLoading />;
  if (elsewhere || gone) return <ResultsLoading />;
  // A search in none of the person's workspaces and not shared with them, as one a chat they were given names: its
  // address alone carries nothing to make their own copy from, so the page says so in place of an empty search.
  if (unknown && home === null && !carried) return <Gone title={t("lost")} />;
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
