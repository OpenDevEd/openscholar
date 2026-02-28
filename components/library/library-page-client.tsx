"use client";

import { useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  useProtectedPaginatedQuery,
  useProtectedQuery,
} from "@/lib/auth/use-auth-query";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { showConfirmation } from "@/lib/confirmation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LibrarySearchBar } from "./library-search-bar";
import { LibraryFilters } from "./library-filters";
import { LibraryItemRow } from "./library-item-row";
import { LibraryItemSkeleton } from "./library-item-skeleton";
import { LibraryEmptyState } from "./library-empty-state";

type SortBy = "savedAt" | "rating" | "publicationYear";
type SortOrder = "asc" | "desc";

export function LibraryPageClient() {
  const t = useTranslations("libraryPage");

  // State
  const [searchText, setSearchText] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("savedAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [minRating, setMinRating] = useState<number | undefined>(undefined);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Debounced search
  const debouncedSearch = useDebouncedValue(searchText, 300);
  const hasSearchText = debouncedSearch.trim().length > 0;

  // Stale-while-revalidate: hold the last non-empty result set
  const lastResultsRef = useRef<Doc<"libraryItems">[]>([]);

  // Dual-path query orchestrator
  const searchResults = useProtectedPaginatedQuery(
    api.library.queries.searchLibrary,
    hasSearchText
      ? { searchText: debouncedSearch, minRating }
      : "skip",
    { initialNumItems: 20 },
  );

  const browseResults = useProtectedPaginatedQuery(
    api.library.queries.browseLibrary,
    !hasSearchText
      ? { sortBy, sortOrder, minRating }
      : "skip",
    { initialNumItems: 20 },
  );

  const activeResults = hasSearchText ? searchResults : browseResults;

  // Update stale results ref when fresh data arrives
  if (activeResults.results.length > 0 || activeResults.hasLoadedFirstPage) {
    lastResultsRef.current = activeResults.results;
  }

  // Total count
  const { data: totalCount } = useProtectedQuery(
    api.library.queries.getLibraryCount,
    {},
  );

  // Removal mutation
  const removeItem = useMutation(api.library.mutations.removeFromLibrary);

  const handleRemove = useCallback(
    (item: Doc<"libraryItems">) => {
      showConfirmation({
        title: t("removeConfirmTitle"),
        message: t("removeConfirmMessage", { title: item.title }),
        confirmText: t("removeButton"),
        cancelText: t("cancelButton"),
        variant: "destructive",
        onConfirm: () => {
          removeItem({ itemId: item._id }).catch((err) => {
            console.error("[Library] Failed to remove:", err);
            toast.error("Failed to remove item");
          });
        },
      });
    },
    [removeItem, t],
  );

  // Toggle expand
  const handleToggleExpand = useCallback((itemId: string) => {
    setExpandedItemId((prev) => (prev === itemId ? null : itemId));
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setSearchText("");
    setMinRating(undefined);
    setSortBy("savedAt");
    setSortOrder("desc");
  }, []);

  // Determine display results (stale-while-revalidate)
  const displayResults =
    activeResults.isInitialLoading && lastResultsRef.current.length > 0
      ? lastResultsRef.current
      : activeResults.results;

  const isTransitioning =
    activeResults.isInitialLoading && lastResultsRef.current.length > 0;

  // Determine what to show
  const isFirstLoad =
    activeResults.isInitialLoading && lastResultsRef.current.length === 0;
  const hasFiltersActive =
    hasSearchText || minRating !== undefined;
  const isEmpty =
    activeResults.hasLoadedFirstPage && activeResults.results.length === 0;
  const isEmptyLibrary = isEmpty && !hasFiltersActive && totalCount === 0;
  const isNoResults = isEmpty && hasFiltersActive;

  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        {totalCount !== undefined && (
          <Badge variant="secondary" className="text-xs">
            {t("paperCount", { count: totalCount })}
          </Badge>
        )}
      </div>

      {/* Search bar */}
      <LibrarySearchBar
        value={searchText}
        onChange={setSearchText}
        className="mb-3"
      />

      {/* Filters */}
      <LibraryFilters
        minRating={minRating}
        onMinRatingChange={setMinRating}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
        sortDisabled={hasSearchText}
      />

      {/* Content area */}
      <div className="mt-4 rounded-lg border border-border/50 bg-background/80 overflow-hidden">
        {/* Initial loading skeleton */}
        {isFirstLoad && <LibraryItemSkeleton count={5} />}

        {/* Empty library */}
        {isEmptyLibrary && (
          <LibraryEmptyState variant="empty-library" />
        )}

        {/* No search/filter results */}
        {isNoResults && (
          <LibraryEmptyState
            variant="no-results"
            onClearFilters={clearFilters}
          />
        )}

        {/* Item list */}
        {displayResults.length > 0 && (
          <div className={isTransitioning ? "opacity-60 transition-opacity" : ""}>
            {displayResults.map((item) => (
              <LibraryItemRow
                key={item._id}
                item={item}
                isExpanded={expandedItemId === item._id}
                onToggleExpand={() => handleToggleExpand(item._id)}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}

        {/* Load more */}
        {activeResults.status === "CanLoadMore" && (
          <div className="flex justify-center py-4 border-t border-border/40">
            <Button
              variant="outline"
              size="sm"
              onClick={() => activeResults.loadMore(20)}
            >
              {t("loadMore")}
            </Button>
          </div>
        )}

        {/* Loading more indicator */}
        {activeResults.status === "LoadingMore" && (
          <div className="py-3">
            <LibraryItemSkeleton count={3} />
          </div>
        )}
      </div>
    </div>
  );
}
