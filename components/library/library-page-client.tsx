"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryStates } from "nuqs";
import { useFormatter, useTranslations } from "next-intl";
import { useConvex } from "convex/react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useProtectedQuery } from "@/lib/auth/use-auth-query";
import { useCursorPage } from "@/lib/hooks/use-cursor-page";
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
import { downloadExport } from "@/lib/export";
import { libraryItemToPaperResult } from "@/lib/library/library-item-to-paper-result";
import {
  downloadLibraryItem,
  downloadLibraryEssentialItem,
} from "@/lib/library/download-handlers";
import { useUIStore } from "@/lib/store";
import type { PaperResult } from "@/lib/types/search.types";
import type { ViewMode } from "@/lib/types";
import {
  TranslationContext,
  ScreeningContext,
  ServerRatingsContext,
} from "@/components/results-contexts";
import { CollectionRatings } from "@/components/workspaces/collection-ratings";
import { PaperCard } from "@/components/paper-card";
import { FocusMode } from "@/components/ui/focus-mode";
import { SidebarLayout } from "@/components/shared/sidebar-layout";
import { PageWrapper } from "@/components/PageWrapper";
import { Button } from "@/components/ui/button";
import { CommandCenterContainer } from "@/components/command-center/command-center-container";
import { cn } from "@/lib/utils";
import { ManageCollectionsDialog, NewCollectionDialog } from "./collection-dialogs";
import { LibraryCommandCenter } from "./library-command-center";
import { LibraryEmptyState } from "./library-empty-state";
import { LibraryFilterSidebar } from "./library-filter-sidebar";
import { LibraryItemSkeleton } from "./library-item-skeleton";
import { inWorkspace, useWorkspace } from "@/lib/workspaces/url";

const PAGE_SIZE = 20;

const GRID_CLASSES: Record<ViewMode, string> = {
  "list-simple": "flex flex-col gap-2",
  "list-detail": "flex flex-col gap-4",
  "grid-2": "grid grid-cols-2 gap-4",
  "grid-3": "grid grid-cols-3 gap-3",
};

export function LibraryPageClient() {
  const workspaceId = useWorkspace();
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
      setParams({ q: debouncedSearch });
    }
  }, [debouncedSearch, params.q, rawSearch, setParams]);

  // Publication date range (date tab in the publication timeframe filter).
  // When a date range is selected, we convert to year params for the backend query.
  const [publicationDateRange, setPublicationDateRange] = useState<DateRange | undefined>(undefined);

  const handlePublicationDateRangeChange = useCallback((range: DateRange | undefined) => {
    setPublicationDateRange(range);
    if (range?.from || range?.to) {
      const yf = range.from ? range.from.getFullYear() : null;
      const yt = range.to ? range.to.getFullYear() : null;
      setParams({ yf, yt });
    } else {
      setParams({ yf: null, yt: null });
    }
  }, [setParams]);

  const [collectionDialog, setCollectionDialog] = useState<"new" | "manage" | null>(null);

  const { data: totalCount } = useProtectedQuery(
    api.library.queries.getLibraryCount,
    inWorkspace(workspaceId, {}),
  );

  const queryText = debouncedSearch.trim();
  const { sortBy: resolvedSortBy, sortOrder: resolvedSortOrder } = useMemo(
    () => parseLibrarySort(params.sort),
    [params.sort],
  );
  const savedAfter = useMemo(
    () => startOfDayTimestampFromParam(params.sf),
    [params.sf],
  );
  const savedBefore = useMemo(
    () => endOfDayTimestampFromParam(params.st),
    [params.st],
  );

  const libraryFilters = useMemo(
    () => ({
      sortBy: resolvedSortBy,
      sortOrder: resolvedSortOrder,
      minRating: params.rmin ?? undefined,
      maxRating: params.rmax ?? undefined,
      savedAfter,
      savedBefore,
      yearFrom: params.yf ?? undefined,
      yearTo: params.yt ?? undefined,
      collectionId: (params.col ?? undefined) as Id<"collections"> | undefined,
    }),
    [
      params.col,
      params.rmax,
      params.rmin,
      params.yf,
      params.yt,
      resolvedSortBy,
      resolvedSortOrder,
      savedAfter,
      savedBefore,
    ],
  );
  const filteredCountQueryArgs = useMemo(
    () => ({
      ...libraryFilters,
      searchText: queryText || undefined,
    }),
    [libraryFilters, queryText],
  );
  const { data: filteredTotalCount } = useProtectedQuery(
    api.library.queries.getLibraryFilteredCount,
    inWorkspace(workspaceId, filteredCountQueryArgs),
  );

  const browseItems = useCursorPage(
    api.library.queries.browseLibrary,
    inWorkspace(workspaceId, queryText ? "skip" : libraryFilters),
    PAGE_SIZE,
  );
  const searchItems = useCursorPage(
    api.library.queries.searchLibrary,
    inWorkspace(workspaceId, queryText ? { ...libraryFilters, searchText: queryText } : "skip"),
    PAGE_SIZE,
  );
  const paged = queryText ? searchItems : browseItems;

  const [isExporting, setIsExporting] = useState(false);
  const convex = useConvex();

  const handleExport = useCallback(
    async (format: "csv" | "json") => {
      if (isExporting) return;
      setIsExporting(true);
      try {
        if (!workspaceId) throw new Error("The workspace hasn't loaded yet. Try again in a moment.");
        await downloadExport(convex, workspaceId, { kind: "library", view: { ...libraryFilters, searchText: queryText || undefined } }, format);
      } catch (error) {
        console.error(`[Library] Failed to start the ${format} export:`, error);
        toast.error(t("exportError"));
      } finally {
        setIsExporting(false);
      }
    },
    [convex, isExporting, libraryFilters, queryText, t, workspaceId],
  );

  const pageItems = paged.items;

  const { isFocusModeOpen } = useUIStore();
  const isMobile = useIsTablet();
  const isLoading = paged.isLoading;

  // Force list-detail on mobile
  const effectiveViewMode: ViewMode = isMobile
    ? "list-detail"
    : (params.view as ViewMode);

  // Convert library items to PaperResult[] for PaperCard/FocusMode
  const paperResults = useMemo(
    () => pageItems.map(libraryItemToPaperResult),
    [pageItems],
  );

  // In an organization's collection, how its members rated each paper there (#655), by the paper.
  const collectionRatings = useMemo(
    () => new Map(pageItems.flatMap((item) => (item.collection ? [[item.openalexId, { libraryItemId: item._id, average: item.rating, ratings: item.collection }] as const] : []))),
    [pageItems],
  );

  // The person's own ratings, from the server, for the cards and FocusMode; null marks a paper they haven't rated
  const serverRatingsMap = useMemo(
    () =>
      new Map(
        pageItems.map((item) => [item.openalexId, item.myRating ?? null]),
      ),
    [pageItems],
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
    });
  }, [setParams]);

  const pageResults = paperResults;
  const pageStart = paged.offset;
  const rangeStart = pageResults.length > 0 ? pageStart + 1 : 0;
  const rangeEnd = rangeStart + pageResults.length - 1;
  const filteredTotal =
    filteredTotalCount && !filteredTotalCount.capped
      ? filteredTotalCount.count
      : paged.hasPages || paged.isLoading
        ? undefined
        : pageItems.length;
  // A count that stopped before the end: at least this many, and at least what's been paged to.
  const filteredAtLeast =
    filteredTotal === undefined && filteredTotalCount?.capped
      ? Math.max(filteredTotalCount.count, pageStart + pageItems.length)
      : undefined;
  const totalPages =
    filteredTotal === undefined
      ? undefined
      : Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  const stepPage = useCallback((step: () => void) => {
    step();
    window.scrollTo({ top: 0 });
  }, []);

  const { data: selectedCollection } = useProtectedQuery(
    api.library.collections.getCollection,
    inWorkspace(workspaceId, params.col ? { collectionId: params.col as Id<"collections"> } : "skip"),
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

  const isEmptyLibrary =
    !isLoading &&
    pageItems.length === 0 &&
    !hasNarrowingCriteria &&
    totalCount === 0;
  const isNoResults =
    !isLoading && pageItems.length === 0 && hasNarrowingCriteria && !paged.hasPages;

  return (
    <TranslationContext.Provider value={{}}>
      <ScreeningContext.Provider value={{}}>
        <ServerRatingsContext.Provider value={serverRatingsMap}>
        <FocusMode
          isOpen={isFocusModeOpen}
          onClose={() => useUIStore.getState().setIsFocusModeOpen(false)}
          papers={paperResults}
          onDownloadItem={handleDownloadItem}
          onDownloadEssentialItem={handleDownloadEssentialItem}
        />

        <SidebarLayout
          sidebar={
            <LibraryFilterSidebar
              ratingRange={[params.rmin ?? 0, params.rmax ?? 5]}
              onRatingRangeChange={(range) => {
                const isDefault = range[0] <= 0 && range[1] >= 5;
                setParams({ rmin: isDefault ? null : range[0], rmax: isDefault ? null : range[1] });
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
                })
              }
              isSavedDateActive={params.sf !== null || params.st !== null}
              yearRange={[params.yf ?? MIN_YEAR, params.yt ?? new Date().getFullYear()]}
              onYearRangeChange={(range) => {
                setParams({ yf: range[0], yt: range[1] });
              }}
              onYearToggleEnabled={(enabled) => {
                setParams({
                  yf: enabled ? params.yf ?? MIN_YEAR : null,
                  yt: enabled ? params.yt ?? new Date().getFullYear() : null,
                });
              }}
              isYearActive={params.yf !== null || params.yt !== null}
              publicationDateRange={publicationDateRange}
              onPublicationDateRangeChange={handlePublicationDateRangeChange}
              isPublicationDateActive={publicationDateRange !== undefined && (publicationDateRange.from !== undefined || publicationDateRange.to !== undefined)}
              collectionId={params.col}
              onCollectionChange={(id) => setParams({ col: id })}
              onManageCollections={() => setCollectionDialog("manage")}
              onNewCollection={() => setCollectionDialog("new")}
              sort={params.sort}
              onSortChange={(value) => setParams({ sort: value })}
              activeFilterCount={activeFilterCount}
              onClearAll={clearSidebarFilters}
            />
          }
        >
          <PageWrapper>
            <div className="container mx-auto max-w-6xl px-4 py-4 sm:px-6 sm:py-6">
              <div className="space-y-6">
                <LibraryCommandCenter
                  // An open collection heads the command center; its name is no longer a filter chip.
                  title={selectedCollection?.name ?? t("title")}
                  rawSearch={rawSearch}
                  onSearchChange={setRawSearch}
                  totalCount={totalCount}
                  filteredCount={filteredTotal ?? filteredAtLeast}
                  filteredCountIsAtLeast={filteredAtLeast !== undefined}
                  activeFilterLabels={activeFilterLabels}
                  viewMode={params.view}
                  onViewModeChange={(mode) =>
                    setParams({ view: mode as LibraryViewMode })
                  }
                  onExportCSV={() => void handleExport("csv")}
                  onExportJSON={() => void handleExport("json")}
                  hasExportableResults={
                    !isExporting &&
                    !isEmptyLibrary &&
                    !isNoResults &&
                    (filteredTotal ?? filteredAtLeast ?? 0) !== 0
                  }
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

                {/* A sparse filter can leave a page empty with more after it: the pager stays to reach them. */}
                {!isLoading && (pageResults.length > 0 || paged.hasPages) && (
                  <>
                    {/* The page shown stays, dimmed and still, until the one it steps to arrives. */}
                    <div className={cn(GRID_CLASSES[effectiveViewMode], paged.isStale && "pointer-events-none opacity-60")}>
                      {pageResults.map((paper, index) => {
                        const globalIndex = pageStart + index;
                        return (
                          <PaperCard
                            key={paper.id}
                            result={paper}
                            resultIndex={globalIndex}
                            onDownloadItem={handleDownloadItem}
                            onDownloadEssentialItem={
                              handleDownloadEssentialItem
                            }
                            viewMode={effectiveViewMode}
                            extra={(() => {
                              const rated = params.col ? collectionRatings.get(paper.id) : undefined;
                              return rated ? <CollectionRatings collectionId={params.col as Id<"collections">} libraryItemId={rated.libraryItemId} average={rated.average} ratings={rated.ratings} compact={effectiveViewMode === "list-simple"} /> : undefined;
                            })()}
                          />
                        );
                      })}
                    </div>

                    <CommandCenterContainer>
                      <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-muted-foreground">
                          {/* An empty page between others has no range; the line keeps its height. */}
                          {pageResults.length === 0
                            ? "\u00a0"
                            : t("showingRange", {
                                start: rangeStart,
                                end: rangeEnd,
                                total:
                                  filteredTotal ??
                                  `${format.number(filteredAtLeast ?? pageStart + pageItems.length)}+`,
                              })}
                        </p>

                        {paged.hasPages && (
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => stepPage(paged.previous)}
                              disabled={!paged.canPrevious}
                              className="rounded-xl"
                            >
                              <ChevronLeft className="mr-1 h-4 w-4" />
                              {t("previousPage")}
                            </Button>

                            <span className="min-w-[110px] text-center text-sm text-muted-foreground">
                              {format.number(paged.page)}
                              {totalPages === undefined
                                ? ` / ${format.number(paged.page)}+`
                                : ` / ${format.number(Math.max(paged.page, totalPages))}`}
                            </span>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => stepPage(paged.next)}
                              disabled={!paged.canNext}
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

              {/* A collection made here opens, as a new folder does. */}
              <NewCollectionDialog open={collectionDialog === "new"} onOpenChange={(open) => setCollectionDialog(open ? "new" : null)} onCreated={(id) => setParams({ col: id })} />
              <ManageCollectionsDialog open={collectionDialog === "manage"} onOpenChange={(open) => setCollectionDialog(open ? "manage" : null)} onNew={() => setCollectionDialog("new")} />

            </div>
          </PageWrapper>
        </SidebarLayout>
        </ServerRatingsContext.Provider>
      </ScreeningContext.Provider>
    </TranslationContext.Provider>
  );
}
