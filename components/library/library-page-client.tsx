"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useQueryStates } from "nuqs";
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
import { useRatingsStore } from "@/lib/store";
import {
  librarySearchParams,
  savedPresetToTimestamp,
} from "@/lib/library/search-params";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { exportLibraryAsCSV, exportLibraryAsJSON } from "@/lib/library/export";
import { LibrarySearchBar } from "./library-search-bar";
import { LibraryFilters } from "./library-filters";
import { LibraryItemRow } from "./library-item-row";
import { LibraryItemCard } from "./library-item-card";
import { LibraryItemSkeleton } from "./library-item-skeleton";
import { LibraryEmptyState } from "./library-empty-state";
import { CollectionManager } from "./collection-manager";
import { CollectionPicker } from "./collection-picker";
import type { Id } from "@/convex/_generated/dataModel";

export function LibraryPageClient() {
  const t = useTranslations("libraryPage");

  // URL-driven state (single source of truth for filter/sort/search)
  const [params, setParams] = useQueryStates(librarySearchParams);

  // Local search input for debounce (don't write every keystroke to URL)
  const [rawSearch, setRawSearch] = useState(params.q);
  const debouncedSearch = useDebouncedValue(rawSearch, 300);

  // Sync debounced search to URL
  useEffect(() => {
    if (debouncedSearch !== params.q) {
      setParams({ q: debouncedSearch });
    }
  }, [debouncedSearch, params.q, setParams]);

  // UI-local state (not URL-persisted)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);

  // Collection state
  const [collectionManagerOpen, setCollectionManagerOpen] = useState(false);
  const [collectionPickerItemId, setCollectionPickerItemId] = useState<string | null>(null);

  // Fetch collections for filter dropdown
  const { data: collectionsWithCounts } = useProtectedQuery(
    api.library.collections.getCollectionsWithCounts,
    {},
  );

  // Derive collection filter from URL param
  const collectionId = params.col ?? undefined;

  // Derive query arguments from params
  const hasSearchText = debouncedSearch.trim().length > 0;
  // Memoize savedAfter so that new Date() is only called when the preset changes,
  // not on every render (which would produce a new timestamp each time and cause
  // Convex to re-run the query in an infinite loop).
  const savedAfter = useMemo(
    () => savedPresetToTimestamp(params.saved),
    [params.saved],
  );
  const minRating = params.rating ?? undefined;
  const yearFrom = params.yf ?? undefined;
  const yearTo = params.yt ?? undefined;

  // Stale-while-revalidate: hold the last non-empty result set
  const lastResultsRef = useRef<Doc<"libraryItems">[]>([]);

  // Dual-path query orchestrator
  const searchResults = useProtectedPaginatedQuery(
    api.library.queries.searchLibrary,
    hasSearchText
      ? { searchText: debouncedSearch, minRating, savedAfter, yearFrom, yearTo, collectionId: collectionId as Id<"collections"> | undefined }
      : "skip",
    { initialNumItems: 20 },
  );

  const browseResults = useProtectedPaginatedQuery(
    api.library.queries.browseLibrary,
    !hasSearchText
      ? { sortBy: params.sort, sortOrder: params.order, minRating, savedAfter, yearFrom, yearTo, collectionId: collectionId as Id<"collections"> | undefined }
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

  // Export data (non-paginated, all items matching current filters)
  const { data: exportItems } = useProtectedQuery(
    api.library.queries.exportLibrary,
    hasSearchText
      ? {
          sortBy: params.sort,
          sortOrder: params.order,
          minRating,
          savedAfter,
          yearFrom,
          yearTo,
          collectionId: collectionId as Id<"collections"> | undefined,
          searchText: debouncedSearch,
        }
      : {
          sortBy: params.sort,
          sortOrder: params.order,
          minRating,
          savedAfter,
          yearFrom,
          yearTo,
          collectionId: collectionId as Id<"collections"> | undefined,
        },
  );

  // Removal mutation
  const removeItem = useMutation(api.library.mutations.removeFromLibrary);
  const { setRating } = useRatingsStore();

  const handleRemove = useCallback(
    (item: Doc<"libraryItems">) => {
      showConfirmation({
        title: t("removeConfirmTitle"),
        message: t("removeConfirmMessage", { title: item.title }),
        confirmText: t("removeButton"),
        cancelText: t("cancelButton"),
        variant: "destructive",
        onConfirm: () => {
          removeItem({ itemId: item._id })
            .then(() => {
              toast.success(t("removedFromLibrary"));
            })
            .catch((err) => {
              console.error("[Library] Failed to remove:", err);
              toast.error(t("removeFromLibraryError"));
            });
          setRating(item.openalexId, null);
        },
      });
    },
    [removeItem, setRating, t],
  );

  // Toggle expand
  const handleToggleExpand = useCallback((itemId: string) => {
    setExpandedItemId((prev) => (prev === itemId ? null : itemId));
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setRawSearch("");
    setParams({
      q: "",
      rating: null,
      saved: null,
      yf: null,
      yt: null,
      col: null,
      sort: "savedAt",
      order: "desc",
    });
  }, [setParams]);

  // Export handlers
  const handleExportCSV = useCallback(() => {
    if (exportItems && exportItems.length > 0) {
      exportLibraryAsCSV(exportItems);
      toast.success(t("exportSuccess"));
    }
  }, [exportItems, t]);

  const handleExportJSON = useCallback(() => {
    if (exportItems && exportItems.length > 0) {
      exportLibraryAsJSON(exportItems);
      toast.success(t("exportSuccess"));
    }
  }, [exportItems, t]);

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
    hasSearchText ||
    minRating !== undefined ||
    savedAfter !== undefined ||
    yearFrom !== undefined ||
    yearTo !== undefined ||
    collectionId !== undefined;
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
        {/* Export dropdown -- only visible when there are items to export */}
        {exportItems && exportItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto">
                <Download className="h-4 w-4 mr-2" />
                {t("exportLibrary")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportCSV}>
                {t("exportAsCSV")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportJSON}>
                {t("exportAsJSON")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Search bar */}
      <LibrarySearchBar
        value={rawSearch}
        onChange={setRawSearch}
        className="mb-3"
      />

      {/* Filters */}
      <LibraryFilters
        minRating={minRating}
        onMinRatingChange={(r) => setParams({ rating: r === undefined ? null : r })}
        sortBy={params.sort}
        onSortByChange={(s) => setParams({ sort: s })}
        sortOrder={params.order}
        onSortOrderChange={(o) => setParams({ order: o })}
        sortDisabled={hasSearchText}
        savedPreset={params.saved}
        onSavedPresetChange={(p) => setParams({ saved: p })}
        yearFrom={params.yf}
        yearTo={params.yt}
        onYearFromChange={(y) => setParams({ yf: y })}
        onYearToChange={(y) => setParams({ yt: y })}
        viewMode={params.view}
        onViewModeChange={(m) => setParams({ view: m })}
        collectionId={params.col}
        onCollectionChange={(id) => setParams({ col: id })}
        collections={collectionsWithCounts}
        onManageCollections={() => setCollectionManagerOpen(true)}
      />

      {/* Content area */}
      <div className="mt-4 rounded-lg border border-border/50 bg-background/80 overflow-hidden">
        {/* Initial loading skeleton */}
        {isFirstLoad && <LibraryItemSkeleton count={params.view === "grid" ? 6 : 5} viewMode={params.view} />}

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
            {params.view === "grid" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
                {displayResults.map((item) => (
                  <LibraryItemCard
                    key={item._id}
                    item={item}
                    onRemove={handleRemove}
                    onAddToCollection={(i) => setCollectionPickerItemId(i._id)}
                  />
                ))}
              </div>
            ) : (
              displayResults.map((item) => (
                <LibraryItemRow
                  key={item._id}
                  item={item}
                  isExpanded={expandedItemId === item._id}
                  onToggleExpand={() => handleToggleExpand(item._id)}
                  onRemove={handleRemove}
                  onAddToCollection={(i) => setCollectionPickerItemId(i._id)}
                />
              ))
            )}
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
            <LibraryItemSkeleton count={3} viewMode={params.view} />
          </div>
        )}
      </div>

      {/* Collection management dialog */}
      <CollectionManager
        open={collectionManagerOpen}
        onOpenChange={setCollectionManagerOpen}
      />

      {/* Collection picker dialog */}
      {collectionPickerItemId && (
        <CollectionPicker
          libraryItemId={collectionPickerItemId as Id<"libraryItems">}
          open={true}
          onOpenChange={(open) => {
            if (!open) setCollectionPickerItemId(null);
          }}
        />
      )}
    </div>
  );
}
