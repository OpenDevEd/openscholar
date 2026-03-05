"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryStates } from "nuqs";
import { useFormatter, useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { showConfirmation } from "@/lib/confirmation";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  endOfDayTimestampFromParam,
  librarySearchParams,
  parseDateParam,
  startOfDayTimestampFromParam,
  type LibrarySortBy,
  type LibraryViewMode,
} from "@/lib/library/search-params";
import { exportLibraryAsCSV, exportLibraryAsJSON } from "@/lib/library/export";
import { useRatingsStore } from "@/lib/store";
import { SidebarLayout } from "@/components/shared/sidebar-layout";
import { PageWrapper } from "@/components/PageWrapper";
import { Button } from "@/components/ui/button";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { CollectionManager } from "./collection-manager";
import { CollectionPicker } from "./collection-picker";
import { LibraryCommandCenter } from "./library-command-center";
import { LibraryEmptyState } from "./library-empty-state";
import { LibraryFilterSidebar } from "./library-filter-sidebar";
import { LibraryItemCard } from "./library-item-card";
import { LibraryItemRow } from "./library-item-row";
import { LibraryItemSkeleton } from "./library-item-skeleton";

const PAGE_SIZE = 20;

export function LibraryPageClient() {
  const t = useTranslations("libraryPage");
  const tf = useTranslations("searchFilters");
  const format = useFormatter();
  const [params, setParams] = useQueryStates(librarySearchParams);

  const [rawSearch, setRawSearch] = useState(params.q);
  const debouncedSearch = useDebouncedValue(rawSearch, 300);

  useEffect(() => {
    setRawSearch(params.q);
  }, [params.q]);

  useEffect(() => {
    if (rawSearch === debouncedSearch && debouncedSearch !== params.q) {
      setParams({ q: debouncedSearch, p: 1 });
    }
  }, [debouncedSearch, params.q, rawSearch, setParams]);

  const [collectionManagerOpen, setCollectionManagerOpen] = useState(false);
  const [collectionPickerItemId, setCollectionPickerItemId] = useState<string | null>(null);

  const { data: collectionsWithCounts } = useProtectedQuery(
    api.library.collections.getCollectionsWithCounts,
    {},
  );

  const { data: totalCount } = useProtectedQuery(
    api.library.queries.getLibraryCount,
    {},
  );

  const queryText = debouncedSearch.trim();
  const savedAfter = useMemo(
    () => startOfDayTimestampFromParam(params.sf),
    [params.sf],
  );
  const savedBefore = useMemo(
    () => endOfDayTimestampFromParam(params.st),
    [params.st],
  );

  const { data: filteredItems } = useProtectedQuery(api.library.queries.listLibrary, {
    sortBy: params.sort,
    sortOrder: params.order,
    minRating: params.rmin ?? undefined,
    maxRating: params.rmax ?? undefined,
    savedAfter,
    savedBefore,
    yearFrom: params.yf ?? undefined,
    yearTo: params.yt ?? undefined,
    collectionId: (params.col ?? undefined) as Id<"collections"> | undefined,
    searchText: queryText || undefined,
  });

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
            .catch((error) => {
              console.error("[Library] Failed to remove item:", error);
              toast.error(t("removeFromLibraryError"));
            });
          setRating(item.openalexId, null);
        },
      });
    },
    [removeItem, setRating, t],
  );

  const handleExportCSV = useCallback(() => {
    if (filteredItems && filteredItems.length > 0) {
      exportLibraryAsCSV(filteredItems);
      toast.success(t("exportSuccess"));
    }
  }, [filteredItems, t]);

  const handleExportJSON = useCallback(() => {
    if (filteredItems && filteredItems.length > 0) {
      exportLibraryAsJSON(filteredItems);
      toast.success(t("exportSuccess"));
    }
  }, [filteredItems, t]);

  const clearSidebarFilters = useCallback(() => {
    setParams({
      rmin: null,
      rmax: null,
      sf: null,
      st: null,
      yf: null,
      yt: null,
      col: null,
      sort: "savedAt",
      order: "desc",
      p: 1,
    });
  }, [setParams]);

  const resetAllNarrowing = useCallback(() => {
    setRawSearch("");
    setParams({
      q: "",
      rmin: null,
      rmax: null,
      sf: null,
      st: null,
      yf: null,
      yt: null,
      col: null,
      sort: "savedAt",
      order: "desc",
      p: 1,
    });
  }, [setParams]);

  const items = filteredItems ?? [];
  const filteredTotal = items.length;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const effectivePage = Math.min(params.p, totalPages);

  useEffect(() => {
    if (params.p !== effectivePage) {
      setParams({ p: effectivePage });
    }
  }, [effectivePage, params.p, setParams]);

  const pageResults = useMemo(
    () =>
      items.slice(
        (effectivePage - 1) * PAGE_SIZE,
        effectivePage * PAGE_SIZE,
      ),
    [effectivePage, items],
  );

  const rangeStart = filteredTotal > 0 ? (effectivePage - 1) * PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min(effectivePage * PAGE_SIZE, filteredTotal);

  const setPageParam = useCallback(
    (page: number) => {
      setParams(
        { p: Math.max(1, Math.min(page, totalPages)) },
        { scroll: true },
      );
    },
    [setParams, totalPages],
  );

  const selectedCollection = useMemo(
    () => collectionsWithCounts?.find((collection) => collection._id === params.col),
    [collectionsWithCounts, params.col],
  );

  const sortLabels = useMemo<Record<LibrarySortBy, string>>(
    () => ({
      savedAt: t("sortDateSaved"),
      rating: t("sortRating"),
      publicationYear: t("sortPublicationYear"),
      citedByCount: tf("filterCitedBy"),
      title: t("sortTitle"),
    }),
    [t, tf],
  );

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];

    if (params.rmin !== null || params.rmax !== null) {
      const min = params.rmin ?? 1;
      const max = params.rmax ?? 5;
      const ratingLabel =
        min === max
          ? tf("filterRatingRangeSingle", { min })
          : tf("filterRatingRangeMulti", { min, max });
      labels.push(`${t("sortRating")}: ${ratingLabel}`);
    }

    const savedFromDate = parseDateParam(params.sf);
    const savedToDate = parseDateParam(params.st);
    if (savedFromDate || savedToDate) {
      const formattedSavedRange =
        savedFromDate && savedToDate
          ? `${format.dateTime(savedFromDate, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })} → ${format.dateTime(savedToDate, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}`
          : savedFromDate
            ? `${format.dateTime(savedFromDate, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}+`
            : format.dateTime(savedToDate!, {
                year: "numeric",
                month: "short",
                day: "numeric",
              });
      labels.push(`${t("filterDateSaved")}: ${formattedSavedRange}`);
    }

    if (params.yf !== null || params.yt !== null) {
      labels.push(
        `${t("filterYearRange")}: ${params.yf ?? "1900"} → ${params.yt ?? new Date().getFullYear()}`,
      );
    }

    if (selectedCollection) {
      labels.push(`${t("filterCollection")}: ${selectedCollection.name}`);
    }

    if (params.sort !== "savedAt" || params.order !== "desc") {
      labels.push(
        `${t("sortBy")}: ${sortLabels[params.sort]} ${params.order === "asc" ? "↑" : "↓"}`,
      );
    }

    return labels;
  }, [
    format,
    params.order,
    params.rmax,
    params.rmin,
    params.sf,
    params.sort,
    params.st,
    params.yf,
    params.yt,
    selectedCollection,
    sortLabels,
    t,
    tf,
  ]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (params.rmin !== null || params.rmax !== null) count += 1;
    if (params.sf !== null || params.st !== null) count += 1;
    if (params.yf !== null || params.yt !== null) count += 1;
    if (params.col !== null) count += 1;
    if (params.sort !== "savedAt" || params.order !== "desc") count += 1;
    return count;
  }, [params.col, params.order, params.rmax, params.rmin, params.sf, params.sort, params.st, params.yf, params.yt]);

  const hasNarrowingCriteria =
    queryText.length > 0 ||
    params.rmin !== null ||
    params.rmax !== null ||
    params.sf !== null ||
    params.st !== null ||
    params.yf !== null ||
    params.yt !== null ||
    params.col !== null;

  const isLoading = filteredItems === undefined;
  const isEmptyLibrary = !isLoading && filteredTotal === 0 && !hasNarrowingCriteria && totalCount === 0;
  const isNoResults = !isLoading && filteredTotal === 0 && hasNarrowingCriteria;

  return (
    <SidebarLayout
      sidebar={
        <LibraryFilterSidebar
          minRating={params.rmin ?? undefined}
          maxRating={params.rmax ?? undefined}
          onRatingChange={(min, max) => setParams({ rmin: min ?? null, rmax: max ?? null, p: 1 })}
          savedFrom={params.sf}
          savedTo={params.st}
          onSavedRangeChange={(from, to) => setParams({ sf: from, st: to, p: 1 })}
          yearFrom={params.yf}
          yearTo={params.yt}
          onYearRangeChange={(from, to) => setParams({ yf: from, yt: to, p: 1 })}
          collectionId={params.col}
          onCollectionChange={(id) => setParams({ col: id, p: 1 })}
          collections={collectionsWithCounts}
          onManageCollections={() => setCollectionManagerOpen(true)}
          sortBy={params.sort}
          sortOrder={params.order}
          onSortByChange={(value) => setParams({ sort: value, p: 1 })}
          onSortOrderChange={(value) => setParams({ order: value, p: 1 })}
          activeFilterCount={activeFilterCount}
          onClearAll={clearSidebarFilters}
        />
      }
    >
      <PageWrapper>
        <div className="container mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
          <div className="space-y-6">
            <LibraryCommandCenter
              rawSearch={rawSearch}
              onSearchChange={setRawSearch}
              totalCount={totalCount}
              filteredCount={filteredItems ? filteredTotal : undefined}
              activeFilterLabels={activeFilterLabels}
              viewMode={params.view}
              onViewModeChange={(mode) => setParams({ view: mode as LibraryViewMode })}
              onExportCSV={handleExportCSV}
              onExportJSON={handleExportJSON}
              hasExportableResults={filteredTotal > 0}
            />

            {isLoading && (
              <LibraryItemSkeleton
                count={params.view === "grid" ? 6 : 4}
                viewMode={params.view}
              />
            )}

            {isEmptyLibrary && <LibraryEmptyState variant="empty-library" />}

            {isNoResults && (
              <LibraryEmptyState
                variant="no-results"
                onClearFilters={resetAllNarrowing}
              />
            )}

            {!isLoading && pageResults.length > 0 && (
              <>
                {params.view === "grid" ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {pageResults.map((item) => (
                      <LibraryItemCard
                        key={item._id}
                        item={item}
                        onRemove={handleRemove}
                        onAddToCollection={(nextItem) => setCollectionPickerItemId(nextItem._id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pageResults.map((item) => (
                      <LibraryItemRow
                        key={item._id}
                        item={item}
                        onRemove={handleRemove}
                        onAddToCollection={(nextItem) => setCollectionPickerItemId(nextItem._id)}
                      />
                    ))}
                  </div>
                )}

                <CommandCenterContainer>
                  <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                      {t("showingRange", {
                        start: rangeStart,
                        end: rangeEnd,
                        total: filteredTotal,
                      })}
                    </p>

                    {totalPages > 1 && (
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPageParam(effectivePage - 1)}
                          disabled={effectivePage <= 1}
                          className="rounded-xl"
                        >
                          <ChevronLeft className="mr-1 h-4 w-4" />
                          {t("previousPage")}
                        </Button>

                        <span className="min-w-[110px] text-center text-sm text-muted-foreground">
                          {format.number(effectivePage)} / {format.number(totalPages)}
                        </span>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPageParam(effectivePage + 1)}
                          disabled={effectivePage >= totalPages}
                          className="rounded-xl"
                        >
                          {t("nextPage")}
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CommandCenterContainer>
              </>
            )}
          </div>

          <CollectionManager
            open={collectionManagerOpen}
            onOpenChange={setCollectionManagerOpen}
          />

          {collectionPickerItemId && (
            <CollectionPicker
              open={collectionPickerItemId !== null}
              onOpenChange={(open) => {
                if (!open) {
                  setCollectionPickerItemId(null);
                }
              }}
              libraryItemId={collectionPickerItemId as Id<"libraryItems">}
            />
          )}
        </div>
      </PageWrapper>
    </SidebarLayout>
  );
}
