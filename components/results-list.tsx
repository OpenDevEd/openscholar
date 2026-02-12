"use client";

import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  createContext,
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
  useSearchHistoryStore,
  useUIStore,
} from "@/lib/store";
import { ViewMode } from "@/lib/types";
import { PaperCard } from "./paper-card/index";
import { useSearch } from "@/lib/search";
import { SearchCommandCenter } from "./search-command-center";

import { NoResults, LoadingResults } from "@/components/no-results";
import { motion, AnimatePresence } from "motion/react";
import { generateMissingScreeningCombinationsByPaper } from "@/lib/screening-utils";
import { ScreeningResponses } from "@/lib/types";
import { FocusMode } from "./ui/focus-mode";
import { downloadEssentialItem, downloadItem } from "@/lib/search-actions";
import { useIsTablet } from "@/lib/hooks";
import { useBatchScreening } from "@/hooks/use-batch-screening";
import { useBatchTranslation } from "@/hooks/use-batch-translation";

interface PapersListProps {
  results: any[];
  filteredResults: any[];
  paginatedResults: any[];
  ratingRange: [number, number];
  onlyRatedPapers: boolean;
  currentPage: number;
  totalPages: number;
  isLoading?: boolean;
  isValidating?: boolean;
  currentQuery?: string;
  onBackToHome?: () => void;
  onDownloadItem: (item: any, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: any, format: "json" | "csv") => void;
  onPageChange: (page: number) => void;
  resultsContainerRef: React.RefObject<HTMLDivElement | null>;
  viewMode: ViewMode;
}

interface ResultsListProps {
  onDownloadItem: (item: any, format: "json" | "csv") => void;
  onDownloadEssentialItem: (item: any, format: "json" | "csv") => void;
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
}

export const ScreeningContext = createContext<{
  missingResponses?: Record<string, string[]>;
  loadingQuestions?: Record<string, Set<string>>;  // paperId -> Set<questionText>
  existingResponses?: ScreeningResponses;
  errors?: Array<{ paperId: string; error: string }>;
  setScreeningResponse?: (paperId: string, question: string, response: boolean) => void;
  setScreeningResponses?: (paperId: string, responses: Record<string, boolean | null>) => void;
  canStartScreening?: boolean;
}>({});

export const TranslationContext = createContext<{
  loadingPaperIds?: Set<string>;
  errors?: Array<{ paperId: string; error: string }>;
}>({});

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
        {paginatedResults.map((result: any, index: number) => {
          const originalIndex = results.findIndex(
            (r: any) => r.id === result.id
          );
          return (
            <PaperCard
              key={`${result.id}-${index}`}
              result={result}
              resultIndex={originalIndex}
              onDownloadItem={onDownloadItem}
              onDownloadEssentialItem={onDownloadEssentialItem}
              viewMode={viewMode}
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
  isLoading = false,
  isValidating = false,
  currentQuery,
  onBackToHome,
}: ResultsListProps) {
  // Use the new search context
  const search = useSearch();
  const results = search.results;
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

  const pathname = usePathname();

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

  // Get the current search ID from the URL
  const searchId = getEffectiveSearchId(pathname, undefined);

  // Get the current search result
  const currentSearchResult = useSearchHistoryStore((state) =>
    searchId ? state.searchHistory.find((item) => item.id === searchId) : null
  );

  const { setScreeningResponse, setScreeningResponses } = useSearchHistoryStore();

  // Get query from URL params
  const urlQuery = search.params.q;

  // Filter results based on rating filter
  const filteredResults = results.filter((result: any) => {
    // Rating filter
    if (isRatingFilterActive(ratingRange, onlyRatedPapers)) {
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

  // Stable callback for batch screening results
  const handleBatchResults = useCallback(
    (paperId: string, responses: Record<string, boolean | null>) => {
      if (searchId) {
        setScreeningResponses(searchId, paperId, responses);
      }
    },
    [searchId, setScreeningResponses]
  );

  // Use batch screening hook
  const { loadingQuestions, errors: screeningErrors } = useBatchScreening({
    searchId: searchId || "",
    papers: papersForBatchScreening,
    missingResponses,
    canStart: canStartScreening && !!searchId,
    onResults: handleBatchResults,
  });

  // Get selected language from URL params
  const selectedLanguage = search.params.lang ?? "";

  // Use batch translation hook
  const { loadingPaperIds: translationLoadingPaperIds, errors: translationErrors } = useBatchTranslation({
    searchId: searchId || "",
    papers: papersForBatchScreening,
    selectedLanguage,
    canStart: canStartScreening && !!searchId,
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
    <TranslationContext.Provider value={{ loadingPaperIds: translationLoadingPaperIds, errors: translationErrors }}>
    <ScreeningContext.Provider
      value={{
        missingResponses,
        loadingQuestions,
        existingResponses: currentSearchResult?.screeningResponses || {},
        errors: screeningErrors,
        setScreeningResponse: (paperId, question, response) => {
          setScreeningResponse(searchId || "", paperId, question, response);
        },
        setScreeningResponses: (paperId, responses) => {
          setScreeningResponses(searchId || "", paperId, responses);
        },
        canStartScreening,
      }}
    >
      <FocusMode
        isOpen={isFocusModeOpen}
        onClose={() => useUIStore.getState().setIsFocusModeOpen(false)}
        papers={filteredResults}
        onDownloadItem={(item, format) => downloadItem(item, format, searchState)}
        onDownloadEssentialItem={(item, format) =>
          downloadEssentialItem(item, format, searchState)
        }
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
          />
        </div>

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
              {isSearching || isInitialLoading ? (
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
