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
import { useIsTablet } from "@/lib/hooks";
import {
  endOfDayTimestampFromParam,
  dateToParam,
  librarySearchParams,
  parseDateParam,
  parseLibrarySort,
  startOfDayTimestampFromParam,
  type LibrarySortCombined,
  type LibraryViewMode,
} from "@/lib/library/search-params";
import { MIN_YEAR } from "@/lib/constants";
import type { DateRange } from "react-day-picker";
import { exportLibraryAsCSV, exportLibraryAsJSON } from "@/lib/library/export";
import { libraryItemToPaperResult } from "@/lib/library/library-item-to-paper-result";
import {
  downloadLibraryItem,
  downloadLibraryEssentialItem,
} from "@/lib/library/download-handlers";
import { useRatingsStore, useUIStore } from "@/lib/store";
import type { PaperResult } from "@/lib/types/search.types";
import type { ViewMode } from "@/lib/types";
import {
  TranslationContext,
  ScreeningContext,
  ServerRatingsContext,
} from "@/components/results-contexts";
import { PaperCard } from "@/components/paper-card";
import { FocusMode } from "@/components/ui/focus-mode";
import { SidebarLayout } from "@/components/shared/sidebar-layout";
import { PageWrapper } from "@/components/PageWrapper";
import { Button } from "@/components/ui/button";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { CollectionManager } from "./collection-manager";
import { CollectionPicker } from "./collection-picker";
import { LibraryCommandCenter } from "./library-command-center";
import { LibraryEmptyState } from "./library-empty-state";
import { LibraryFilterSidebar } from "./library-filter-sidebar";
import { LibraryItemActions } from "./library-item-shared";
import { LibraryItemSkeleton } from "./library-item-skeleton";

const PAGE_SIZE = 20;

const GRID_CLASSES: Record<ViewMode, string> = {
  "list-simple": "flex flex-col gap-2",
  "list-detail": "flex flex-col gap-4",
  "grid-2": "grid grid-cols-2 gap-4",
  "grid-3": "grid grid-cols-3 gap-3",
};

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
  const [collectionPickerItemId, setCollectionPickerItemId] = useState<
    string | null
  >(null);

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

  const { sortBy: resolvedSortBy, sortOrder: resolvedSortOrder } = useMemo(
    () => parseLibrarySort(params.sort),
    [params.sort],
  );

  const { data: filteredItems } = useProtectedQuery(
    api.library.queries.listLibrary,
    {
      sortBy: resolvedSortBy,
      sortOrder: resolvedSortOrder,
      minRating: params.rmin ?? undefined,
      maxRating: params.rmax ?? undefined,
      savedAfter,
      savedBefore,
      yearFrom: params.yf ?? undefined,
      yearTo: params.yt ?? undefined,
      collectionId: (params.col ?? undefined) as Id<"collections"> | undefined,
      searchText: queryText || undefined,
    },
  );

  const removeItem = useMutation(api.library.mutations.removeFromLibrary);
  const { setRating } = useRatingsStore();
  const { isFocusModeOpen } = useUIStore();
  const isMobile = useIsTablet();

  // Force list-detail on mobile
  const effectiveViewMode: ViewMode = isMobile
    ? "list-detail"
    : (params.view as ViewMode);

  // Convert library items to PaperResult[] for PaperCard/FocusMode
  const paperResults = useMemo(
    () => (filteredItems ?? []).map(libraryItemToPaperResult),
    [filteredItems],
  );

  // Lookup map: openalexId -> Doc<"libraryItems"> for library-specific actions
  const libraryItemMap = useMemo(
    () =>
      new Map(
        (filteredItems ?? []).map((item) => [item.openalexId, item]),
      ),
    [filteredItems],
  );

  // Server-authoritative ratings map for FocusMode
  const serverRatingsMap = useMemo(
    () =>
      new Map(
        (filteredItems ?? []).map((item) => [item.openalexId, item.rating]),
      ),
    [filteredItems],
  );

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

  // Download handlers for PaperCard and FocusMode
  const handleDownloadItem = useCallback(
    (item: PaperResult, fmt: "json" | "csv") => {
      downloadLibraryItem(item, fmt);
    },
    [],
  );

  const handleDownloadEssentialItem = useCallback(
    (item: PaperResult, fmt: "json" | "csv") => {
      downloadLibraryEssentialItem(item, fmt);
    },
    [],
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
      sort: "savedAt:desc",
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
      sort: "savedAt:desc",
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
      paperResults.slice(
        (effectivePage - 1) * PAGE_SIZE,
        effectivePage * PAGE_SIZE,
      ),
    [effectivePage, paperResults],
  );

  const rangeStart =
    filteredTotal > 0 ? (effectivePage - 1) * PAGE_SIZE + 1 : 0;
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
    () =>
      collectionsWithCounts?.find(
        (collection) => collection._id === params.col,
      ),
    [collectionsWithCounts, params.col],
  );

  const sortLabelMap = useMemo<Record<LibrarySortCombined, string>>(
    () => ({
      "savedAt:desc": t("sortSavedAtDesc"),
      "savedAt:asc": t("sortSavedAtAsc"),
      "rating:desc": t("sortRatingDesc"),
      "rating:asc": t("sortRatingAsc"),
      "publicationYear:desc": t("sortPublicationYearDesc"),
      "publicationYear:asc": t("sortPublicationYearAsc"),
      "citedByCount:desc": t("sortCitationsDesc"),
      "citedByCount:asc": t("sortCitationsAsc"),
      "title:asc": t("sortTitleAsc"),
      "title:desc": t("sortTitleDesc"),
    }),
    [t],
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

    if (params.sort !== "savedAt:desc") {
      labels.push(`${t("sortBy")}: ${sortLabelMap[params.sort]}`);
    }

    return labels;
  }, [
    format,
    params.rmax,
    params.rmin,
    params.sf,
    params.sort,
    params.st,
    params.yf,
    params.yt,
    selectedCollection,
    sortLabelMap,
    t,
    tf,
  ]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (params.rmin !== null || params.rmax !== null) count += 1;
    if (params.sf !== null || params.st !== null) count += 1;
    if (params.yf !== null || params.yt !== null) count += 1;
    if (params.col !== null) count += 1;
    if (params.sort !== "savedAt:desc") count += 1;
    return count;
  }, [
    params.col,
    params.rmax,
    params.rmin,
    params.sf,
    params.sort,
    params.st,
    params.yf,
    params.yt,
  ]);

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
  const isEmptyLibrary =
    !isLoading &&
    filteredTotal === 0 &&
    !hasNarrowingCriteria &&
    totalCount === 0;
  const isNoResults =
    !isLoading && filteredTotal === 0 && hasNarrowingCriteria;

  return (
    <TranslationContext.Provider value={{}}>
      <ScreeningContext.Provider value={{}}>
        <ServerRatingsContext.Provider value={serverRatingsMap}>
        <FocusMode
          key={isFocusModeOpen ? "open" : "closed"}
          isOpen={isFocusModeOpen}
          onClose={() => useUIStore.getState().setIsFocusModeOpen(false)}
          papers={paperResults}
          onDownloadItem={handleDownloadItem}
          onDownloadEssentialItem={handleDownloadEssentialItem}
        />

        <SidebarLayout
          sidebar={
            <LibraryFilterSidebar
              ratingRange={[params.rmin ?? 1, params.rmax ?? 5]}
              onRatingRangeChange={(range) => {
                const isDefault = range[0] <= 1 && range[1] >= 5;
                setParams({ rmin: isDefault ? null : range[0], rmax: isDefault ? null : range[1], p: 1 });
              }}
              isRatingActive={params.rmin !== null || params.rmax !== null}
              savedDateRange={(() => {
                const from = parseDateParam(params.sf);
                const to = parseDateParam(params.st);
                if (!from && !to) return undefined;
                return { from, to } as DateRange;
              })()}
              onSavedDateRangeChange={(range) =>
                setParams({
                  sf: range?.from ? dateToParam(range.from) : null,
                  st: range?.to ? dateToParam(range.to) : null,
                  p: 1,
                })
              }
              isSavedDateActive={params.sf !== null || params.st !== null}
              yearRange={[params.yf ?? MIN_YEAR, params.yt ?? new Date().getFullYear()]}
              onYearRangeChange={(range) => {
                const currentYear = new Date().getFullYear();
                const isDefault = range[0] === MIN_YEAR && range[1] === currentYear;
                setParams({ yf: isDefault ? null : range[0], yt: isDefault ? null : range[1], p: 1 });
              }}
              isYearActive={params.yf !== null || params.yt !== null}
              collectionId={params.col}
              onCollectionChange={(id) => setParams({ col: id, p: 1 })}
              collections={collectionsWithCounts}
              onManageCollections={() => setCollectionManagerOpen(true)}
              sort={params.sort}
              onSortChange={(value) => setParams({ sort: value, p: 1 })}
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
                  filteredCount={
                    filteredItems ? filteredTotal : undefined
                  }
                  activeFilterLabels={activeFilterLabels}
                  viewMode={params.view}
                  onViewModeChange={(mode) =>
                    setParams({ view: mode as LibraryViewMode })
                  }
                  onExportCSV={handleExportCSV}
                  onExportJSON={handleExportJSON}
                  hasExportableResults={filteredTotal > 0}
                />

                {isLoading && (
                  <LibraryItemSkeleton
                    count={
                      effectiveViewMode === "grid-2" ||
                      effectiveViewMode === "grid-3"
                        ? 6
                        : 4
                    }
                    viewMode={effectiveViewMode}
                  />
                )}

                {isEmptyLibrary && (
                  <LibraryEmptyState variant="empty-library" />
                )}

                {isNoResults && (
                  <LibraryEmptyState
                    variant="no-results"
                    onClearFilters={resetAllNarrowing}
                  />
                )}

                {!isLoading && pageResults.length > 0 && (
                  <>
                    <div className={GRID_CLASSES[effectiveViewMode]}>
                      {pageResults.map((paper, index) => {
                        const globalIndex =
                          (effectivePage - 1) * PAGE_SIZE + index;
                        const libraryItem = libraryItemMap.get(paper.id);

                        return (
                          <div key={paper.id} className="relative group">
                            <PaperCard
                              result={paper}
                              resultIndex={globalIndex}
                              onDownloadItem={handleDownloadItem}
                              onDownloadEssentialItem={
                                handleDownloadEssentialItem
                              }
                              viewMode={effectiveViewMode}
                            />
                            {/* Library-specific actions overlay */}
                            {libraryItem && (
                              <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                                <LibraryItemActions
                                  item={libraryItem}
                                  onRemove={handleRemove}
                                  onAddToCollection={(nextItem) =>
                                    setCollectionPickerItemId(nextItem._id)
                                  }
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

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
                              onClick={() =>
                                setPageParam(effectivePage - 1)
                              }
                              disabled={effectivePage <= 1}
                              className="rounded-xl"
                            >
                              <ChevronLeft className="mr-1 h-4 w-4" />
                              {t("previousPage")}
                            </Button>

                            <span className="min-w-[110px] text-center text-sm text-muted-foreground">
                              {format.number(effectivePage)} /{" "}
                              {format.number(totalPages)}
                            </span>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setPageParam(effectivePage + 1)
                              }
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
                  libraryItemId={
                    collectionPickerItemId as Id<"libraryItems">
                  }
                />
              )}
            </div>
          </PageWrapper>
        </SidebarLayout>
        </ServerRatingsContext.Provider>
      </ScreeningContext.Provider>
    </TranslationContext.Provider>
  );
}
