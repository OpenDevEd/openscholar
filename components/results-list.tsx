"use client";

import { useAnsweredPapers, useRatedPapers } from "@/lib/research/reads";
import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
} from "react";
import { usePathname } from "next/navigation";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn, isRatingFilterActive, getEffectiveSearchId } from "@/lib/utils";
import { ITEMS_PER_PAGE } from "@/lib/constants";
import {
  useRatingsStore,
  useResultsTranslationSettingsStore,
  useSearchHistoryStore,
  useUIStore,
} from "@/lib/store";
import { ViewMode, type PaperResult } from "@/lib/types";
import { PaperCard } from "./paper-card";
import type { PaperCardHide } from "./paper-card/shared";
import { useSearch } from "@/lib/search";
import { SearchCommandCenter } from "./search-command-center";

import { NoResults, LoadingResults, QueryErrorState } from "@/components/no-results";
import { rejectedQuery } from "@/lib/search/search-error";
import { OQL_FIELD } from "@/lib/openalex/oql";
import { motion, AnimatePresence } from "motion/react";
import { generateMissingScreeningCombinationsByPaper } from "@/lib/screening-utils";
import { ScreeningContext, TranslationContext } from "@/components/results-contexts";
import { FocusMode } from "./ui/focus-mode";
import { useIsTablet } from "@/lib/hooks";
import { useBatchScreening } from "@/hooks/use-batch-screening";
import { useBatchTranslation } from "@/hooks/use-batch-translation";
import { ScreeningErrorAlert } from "@/components/screening/screening-error-alert";

interface PapersListProps {
  results: PaperResult[];
  filteredResults: PaperResult[];
  paginatedResults: PaperResult[];
  ratingRange: [number, number];
  onlyRatedPapers: boolean;
  currentPage: number;
  totalPages: number;
  isLoading?: boolean;
  isValidating?: boolean;
  currentQuery?: string;
  onBackToHome?: () => void;
  onDownloadItem: (item: PaperResult, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: PaperResult, format: "json" | "csv") => void;
  onPageChange: (page: number) => void;
  resultsContainerRef: React.RefObject<HTMLDivElement | null>;
  viewMode: ViewMode;
  hide?: PaperCardHide;
}

interface ResultsListProps {
  onDownloadItem: (item: PaperResult, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: PaperResult, format: "json" | "csv") => void;
  // Download all handlers for mobile ResultsFilter
  onDownloadAllJSON?: () => void;
  onDownloadAllCSV?: () => void;
  onDownloadAllEssentialJSON?: () => void;
  onDownloadAllEssentialCSV?: () => void;
  // Loading and results state
  isLoading?: boolean;
  isValidating?: boolean;
  currentQuery?: string;
  onBackToHome?: () => void;
  /**
   * Shows what a search finds without acting on it: no screening, results
   * translation, focus mode, ratings or downloads. Used where a search is
   * being set up, such as an Evidence Library import.
   */
  preview?: boolean;
}

function PapersGrid({
  results,
  paginatedResults,
  currentPage,
  totalPages,
  filteredResults,
  onDownloadItem,
  onDownloadEssentialItem,
  onPageChange,
  resultsContainerRef,
  viewMode,
  hide,
}: PapersListProps) {
  const gridClasses = {
    "list-simple": "flex flex-col gap-2",
    "list-detail": "flex flex-col gap-4",
    "grid-2": "grid grid-cols-2 gap-4",
    "grid-3": "grid grid-cols-3 gap-3",
  };

  return (
    <div ref={resultsContainerRef}>
      <div className={cn(gridClasses[viewMode])}>
        {paginatedResults.map((result, index) => {
          const originalIndex = results.findIndex(
            (r) => r.id === result.id
          );
          return (
            <PaperCard
              key={result.id}
              result={result}
              resultIndex={originalIndex}
              onDownloadItem={onDownloadItem}
              onDownloadEssentialItem={onDownloadEssentialItem}
              viewMode={viewMode}
              hide={hide}
            />
          );
        })}
      </div>

      {filteredResults.length > ITEMS_PER_PAGE && (
        <div className="flex justify-center pt-8">
          <Pagination>
            <PaginationContent className="flex-wrap justify-center">
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                  className={cn(
                    "cursor-pointer",
                    currentPage === 1 && "pointer-events-none opacity-50"
                  )}
                />
              </PaginationItem>

              {/* Show page numbers with ellipsis for large page counts */}
              {totalPages <= 7 ? (
                // Show all pages if 7 or fewer
                Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (page) => (
                    <PaginationItem key={page}>
                      <PaginationLink
                        onClick={() => onPageChange(page)}
                        isActive={currentPage === page}
                        className="cursor-pointer"
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  )
                )
              ) : (
                // Show pages with ellipsis for large page counts
                <>
                  {/* Always show first page */}
                  <PaginationItem>
                    <PaginationLink
                      onClick={() => onPageChange(1)}
                      isActive={currentPage === 1}
                      className="cursor-pointer"
                    >
                      1
                    </PaginationLink>
                  </PaginationItem>

                  {/* Show ellipsis if current page is far from start */}
                  {currentPage > 4 && (
                    <PaginationItem>
                      <span className="px-3 py-2">...</span>
                    </PaginationItem>
                  )}

                  {/* Show pages around current page */}
                  {Array.from(
                    { length: Math.min(5, totalPages - 2) },
                    (_, i) => {
                      const page = Math.max(
                        2,
                        Math.min(totalPages - 1, currentPage - 2 + i)
                      );
                      return page;
                    }
                  )
                    .filter(
                      (page, index, array) => array.indexOf(page) === index
                    ) // Remove duplicates
                    .filter((page) => page > 1 && page < totalPages) // Exclude first and last
                    .map((page) => (
                      <PaginationItem key={page}>
                        <PaginationLink
                          onClick={() => onPageChange(page)}
                          isActive={currentPage === page}
                          className="cursor-pointer"
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                    ))}

                  {/* Show ellipsis if current page is far from end */}
                  {currentPage < totalPages - 3 && (
                    <PaginationItem>
                      <span className="px-3 py-2">...</span>
                    </PaginationItem>
                  )}

                  {/* Always show last page */}
                  {totalPages > 1 && (
                    <PaginationItem>
                      <PaginationLink
                        onClick={() => onPageChange(totalPages)}
                        isActive={currentPage === totalPages}
                        className="cursor-pointer"
                      >
                        {totalPages}
                      </PaginationLink>
                    </PaginationItem>
                  )}
                </>
              )}

              <PaginationItem>
                <PaginationNext
                  onClick={() =>
                    onPageChange(Math.min(totalPages, currentPage + 1))
                  }
                  className={cn(
                    "cursor-pointer",
                    currentPage === totalPages &&
                      "pointer-events-none opacity-50"
                  )}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}

export function ResultsList({
  onDownloadItem,
  onDownloadEssentialItem,
  onDownloadAllJSON,
  onDownloadAllCSV,
  onDownloadAllEssentialJSON,
  onDownloadAllEssentialCSV,
  isLoading: searching = false,
  isValidating = false,
  currentQuery,
  onBackToHome,
  preview = false,
}: ResultsListProps) {
  // Use the new search context
  const search = useSearch();
  const queryError = rejectedQuery(search.error);
  // Get the current search ID from the URL
  const pathname = usePathname();
  const searchId = getEffectiveSearchId(pathname, search.searchId || undefined);
  // The rating filter reads the ratings of every result, not only the cards on screen, and a
  // result waits for its rating, so its card opens at its final size. It waits for its
  // screening answers too, so a paper already answered isn't screened again.
  const rated = useRatedPapers(search.results);
  const answered = useAnsweredPapers(searchId ?? undefined, rated.papers);
  const results = answered.papers;
  const isLoading = searching || rated.loading || answered.loading;
  const totalCount = search.totalCount;
  
  // Get pagination from URL params (source of truth)
  const currentPage = search.params.page;

  // Get rating filter values from params
  const ratingRange: [number, number] = [search.params.rmin, search.params.rmax];
  const onlyRatedPapers = search.params.rated;

  // Create searchState for download functions (backwards compatibility)
  const searchState = {
    query: search.params.q,
    field: search.params.field,
    oql: search.oql,
    dateRange:
      search.params.df || search.params.dt
        ? {
            from: search.params.df ? new Date(search.params.df) : undefined,
            to: search.params.dt ? new Date(search.params.dt) : undefined,
          }
        : undefined,
    yearRange:
      search.params.yf && search.params.yt
        ? ([search.params.yf, search.params.yt] as [number, number])
        : undefined,
  };

  const { ratings } = useRatingsStore();
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const [canStartScreening, setCanStartScreening] = useState(false);
  const [showInitialLoading, setShowInitialLoading] = useState(true);


  useEffect(() => {
    const timer = setTimeout(() => setShowInitialLoading(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  const { isFocusModeOpen, focusModeIndex, viewMode } = useUIStore();
  const isMobile = useIsTablet();
  
  // Force list-detail on mobile
  const effectiveViewMode: ViewMode = isMobile ? "list-detail" : viewMode;

  useEffect(() => {
    setTimeout(() => {
      setCanStartScreening(true);
    }, 2000);
  }, []);

  // Get the current search result
  const currentSearchResult = useSearchHistoryStore((state) =>
    searchId ? state.searchHistory.find((item) => item.id === searchId) : null
  );

  const { setScreeningResponse, setScreeningResponses } = useSearchHistoryStore();
  const autoTranslateResults = useResultsTranslationSettingsStore(
    (state) => state.autoTranslateResults
  );
  const targetLanguageOverride = useResultsTranslationSettingsStore(
    (state) => state.targetLanguageOverride
  );
  const manualRunRequestId = useResultsTranslationSettingsStore(
    (state) => state.manualRunRequestId
  );

  // Get query from URL params
  const urlQuery = search.params.q;

  // Filter results based on rating filter
  const filteredResults = results.filter((result) => {
    // Rating filter
    if (!preview && isRatingFilterActive(ratingRange, onlyRatedPapers)) {
      const paperRating = ratings[result.id];

      if (paperRating === undefined) {
        return false;
      }

      if (paperRating < ratingRange[0] || paperRating > ratingRange[1]) {
        return false;
      }
    }

    return true;
  });

  const totalPages = useMemo(
    () => Math.ceil(filteredResults.length / ITEMS_PER_PAGE),
    [filteredResults]
  );
  const paginatedResults = useMemo(
    () =>
      filteredResults.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
      ),
    [filteredResults, currentPage]
  );

  // Calculate which papers to batch screen
  // In focus mode: batch the group of 20 containing the focused paper
  // In normal mode: batch the current page
  const papersForBatchScreening = useMemo(() => {
    if (isFocusModeOpen) {
      // Batch in groups of 20 based on focus index
      const batchStart = Math.floor(focusModeIndex / ITEMS_PER_PAGE) * ITEMS_PER_PAGE;
      const batchEnd = Math.min(batchStart + ITEMS_PER_PAGE, filteredResults.length);
      return filteredResults.slice(batchStart, batchEnd);
    }
    return paginatedResults;
  }, [isFocusModeOpen, focusModeIndex, filteredResults, paginatedResults]);

  const missingResponses = useMemo(() => {
    return generateMissingScreeningCombinationsByPaper(
      papersForBatchScreening,
      currentSearchResult?.screeningQuestions || [],
      currentSearchResult?.screeningResponses || {}
    );
  }, [
    papersForBatchScreening,
    currentSearchResult?.screeningQuestions,
    currentSearchResult?.screeningResponses,
  ]);

  // Manual-retry trigger for the screening alert. Bumping it appends a
  // new token to questionSetKey, which changes the batch-screening
  // contextId — that clears the dedup ref (via useBatchOperation's
  // contextId-change effect) and lets the failed batch refire.
  const [screeningRetryVersion, setScreeningRetryVersion] = useState(0);

  // Stable identifier for the active question set — folded into the
  // batch-screening contextId so a question-set edit invalidates the
  // dedup ref and surfaces a fresh batch.
  const questionSetKey = useMemo(
    () =>
      [
        ...(currentSearchResult?.screeningQuestions ?? []).map(
          (q) => q.question,
        ),
        `retry:${screeningRetryVersion}`,
      ].join("|"),
    [currentSearchResult?.screeningQuestions, screeningRetryVersion]
  );

  // Stable callback for batch screening results
  const handleBatchResults = useCallback(
    (paperId: string, responses: Record<string, boolean | null>, confidences?: Record<string, number>) => {
      if (searchId) {
        setScreeningResponses(searchId, paperId, responses, confidences);
      }
    },
    [searchId, setScreeningResponses]
  );

  // Primitive selector — returns a boolean so re-renders only happen
  // when the slice actually flips, not on every store mutation.
  const isScreeningPanelOpen = useUIStore((s) =>
    searchId ? s.screeningPanelOpenBySearchId[searchId] ?? false : false,
  );

  // Use batch screening hook. Gated on the panel being open so the
  // batch action does not fire while the user has the panel collapsed.
  const { loadingQuestions, errors: screeningErrors } = useBatchScreening({
    searchId: searchId || "",
    papers: papersForBatchScreening,
    missingResponses,
    questionSetKey,
    // Not while the saved answers couldn't be read: every paper would look unanswered.
    canStart: !preview && canStartScreening && !!searchId && isScreeningPanelOpen && !answered.failed,
    onResults: handleBatchResults,
  });

  const isScreeningInFlight = Object.keys(loadingQuestions).length > 0;
  const handleRetryScreening = useCallback(() => {
    setScreeningRetryVersion((v) => v + 1);
  }, []);

  const papersForBatchTranslation = paginatedResults;

  // Use batch translation hook
  const {
    loadingPaperIds: translationLoadingPaperIds,
    errors: translationErrors,
    isConfigured: isTranslationConfigured,
    translatedPaperCount,
    totalPaperCount,
  } = useBatchTranslation({
    searchId: searchId || "",
    papers: papersForBatchTranslation,
    canStart: !preview && !!searchId,
    isSearchLoading: isLoading || isValidating,
    autoTranslateResults,
    manualRunRequestId,
    targetLanguageOverride,
  });

  // Notify Zotero when results change
  useEffect(() => {
    if (paginatedResults.length > 0 || isFocusModeOpen) {
      document.dispatchEvent(
        new Event("ZoteroItemUpdated", {
          bubbles: true,
          cancelable: true,
        })
      );
    }

    if (currentPage > totalPages && totalPages > 0) {
      search.setPage(1);
    }
  }, [paginatedResults, isFocusModeOpen, focusModeIndex, currentPage, totalPages, search]);

  const handlePageChange = (page: number) => {
    search.setPage(page);
  };

  return (
    <TranslationContext.Provider
      value={{
        loadingPaperIds: translationLoadingPaperIds,
        errors: translationErrors,
        isConfigured: isTranslationConfigured,
        translatedPaperCount,
        totalPaperCount,
      }}
    >
    <ScreeningContext.Provider
      value={{
        missingResponses,
        loadingQuestions,
        existingResponses: currentSearchResult?.screeningResponses || {},
        setScreeningResponse: (paperId, question, response) => {
          setScreeningResponse(searchId || "", paperId, question, response);
        },
        setScreeningResponses: (paperId, responses) => {
          setScreeningResponses(searchId || "", paperId, responses);
        },
        canStartScreening: canStartScreening && !preview,
        isScreeningPanelOpen: isScreeningPanelOpen && !preview,
      }}
    >
      <FocusMode
        key={isFocusModeOpen ? "open" : "closed"}
        isOpen={isFocusModeOpen && !preview}
        onClose={() => useUIStore.getState().setIsFocusModeOpen(false)}
        papers={filteredResults}
        onDownloadItem={onDownloadItem}
        onDownloadEssentialItem={onDownloadEssentialItem}
      />
      <div className="flex flex-col">
        {/* New Search Command Center */}
        <div className="mb-6">
          <SearchCommandCenter
            searchId={searchId || ""}
            totalCount={totalCount}
            currentQuery={urlQuery}
            isLoading={isLoading}
            isValidating={isValidating}
            onDownloadAllJSON={onDownloadAllJSON}
            onDownloadAllCSV={onDownloadAllCSV}
            onDownloadAllEssentialJSON={onDownloadAllEssentialJSON}
            onDownloadAllEssentialCSV={onDownloadAllEssentialCSV}
            queryOnly={preview}
          />
        </div>

        {/* Inline alert for batch-screening errors. Sits above the
            results area so the user sees it whether the screening panel
            is open or collapsed. */}
        {screeningErrors.length > 0 && (
          <div className="mb-4">
            <ScreeningErrorAlert
              errors={screeningErrors}
              onRetry={handleRetryScreening}
              canRetry={!isScreeningInFlight}
            />
          </div>
        )}

        {/* Single results area – loading, no-results, and papers all rendered here */}
        {(() => {
          const isSearching =
            (isLoading || isValidating) && results.length === 0;
          const isInitialLoading =
            results.length === 0 &&
            showInitialLoading &&
            !isLoading &&
            !isValidating;
          const isEmptySearch =
            results.length === 0 && !showInitialLoading;
          const isEmptyFilter =
            paginatedResults.length === 0 && results.length > 0;
          const showValidatingBanner =
            isValidating && results.length > 0;

          return (
            <>
              {showValidatingBanner && (
                <AnimatePresence>
                  <motion.div
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: "auto", marginBottom: 24 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{
                      type: "spring",
                      stiffness: 400,
                      damping: 30,
                    }}
                    className="overflow-hidden"
                  >
                    <LoadingResults variant="banner" />
                  </motion.div>
                </AnimatePresence>
              )}
              {queryError ? (
                <QueryErrorState detail={queryError} oql={search.params.field === OQL_FIELD} />
              ) : isSearching || isInitialLoading ? (
                <LoadingResults />
              ) : isEmptySearch ? (
                <NoResults
                  query={currentQuery}
                  onTryNewSearch={onBackToHome}
                />
              ) : isEmptyFilter ? (
                <NoResults
                  variant="filter"
                  query={currentQuery}
                  onTryNewSearch={onBackToHome}
                />
              ) : (
                <PapersGrid
                  results={results}
                  filteredResults={filteredResults}
                  paginatedResults={paginatedResults}
                  ratingRange={ratingRange}
                  onlyRatedPapers={onlyRatedPapers}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  isLoading={isLoading}
                  isValidating={isValidating}
                  currentQuery={currentQuery}
                  onBackToHome={onBackToHome}
                  onDownloadItem={onDownloadItem}
                  onDownloadEssentialItem={onDownloadEssentialItem}
                  onPageChange={handlePageChange}
                  resultsContainerRef={resultsContainerRef}
                  viewMode={effectiveViewMode}
                  hide={preview ? { rating: true, download: true, focusMode: true } : undefined}
                />
              )}
            </>
          );
        })()}
      </div>
    </ScreeningContext.Provider>
    </TranslationContext.Provider>
  );
}
