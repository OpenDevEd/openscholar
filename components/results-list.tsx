"use client";

import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  createContext,
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
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { generateMissingScreeningCombinationsByPaper } from "@/lib/screening-utils";
import { ScreeningResponses } from "@/lib/types";
import { FocusMode } from "./ui/focus-mode";
import { downloadEssentialItem, downloadItem } from "@/lib/search-actions";
import { useIsTablet } from "@/lib/hooks";

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
  loadingResponses?: Record<string, Record<string, boolean>>;
  existingResponses?: ScreeningResponses;
  setScreeningResponse?: (paperId: string, question: string, response: boolean) => void;
  setScreeningResponses?: (paperId: string, responses: Record<string, boolean | null>) => void;
  canStartScreening?: boolean;
}>({});

function PapersList({
  results,
  filteredResults,
  paginatedResults,
  ratingRange,
  onlyRatedPapers,
  currentPage,
  totalPages,
  isLoading = false,
  isValidating = false,
  currentQuery,
  onBackToHome,
  onDownloadItem,
  onDownloadEssentialItem,
  onPageChange,
  resultsContainerRef,
  viewMode,
}: PapersListProps) {
  const [showInitialLoading, setShowInitialLoading] = React.useState(true);

  // Show initial loading for first 5 seconds, even if there are no results
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setShowInitialLoading(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, []);

  // Show loading state when:
  // 1. Actively loading/validating with no results, OR
  // 2. Within first 5 seconds with no results and not actively loading
  if (
    ((isLoading || isValidating) && results.length === 0) ||
    (results.length === 0 && showInitialLoading && !isLoading && !isValidating)
  ) {
    return (
      <div className="text-center py-12">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <div>
            <h2 className="text-xl font-semibold mb-2">Loading Results</h2>
            <p className="text-muted-foreground">
              Searching through millions of academic papers...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Show no results when there are no results but there is a query (only after initial 5 seconds)
  if (results.length === 0 && currentQuery && !showInitialLoading) {
    return (
      <div className="text-center py-12">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
            <Search className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">No Results Found</h2>
            <p className="text-muted-foreground mb-4">
              No papers found for "{currentQuery}". Try adjusting your search
              terms or filters.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button variant="outline" onClick={onBackToHome}>
                Try New Search
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show default no results when there are no results and no query (only after initial 5 seconds)
  if (results.length === 0 && !showInitialLoading) {
    return (
      <div className="text-center py-12">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center">
            <Search className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">No Results Found</h2>
            <p className="text-muted-foreground mb-4">
              No papers found. Try adjusting your search terms or filters.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Button variant="outline" onClick={onBackToHome}>
                Try New Search
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Determine grid layout classes based on view mode
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
          // Calculate the global index in the filtered results
          const globalIndex = (currentPage - 1) * ITEMS_PER_PAGE + index;
          // Find the index in the original unfiltered results array
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
        {paginatedResults.length === 0 && (
          <div className="text-center py-12">
            <p className="text-lg text-muted-foreground">
              {isRatingFilterActive(ratingRange, onlyRatedPapers)
                ? "No results match your filters"
                : "No results found"}
            </p>
            {isRatingFilterActive(ratingRange, onlyRatedPapers) && (
              <p className="text-sm text-muted-foreground mt-2">
                Try adjusting your filter settings
              </p>
            )}
          </div>
        )}
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
  const [combinationLoading, setCombinationLoading] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [canStartScreening, setCanStartScreening] = useState(false);

  const pathname = usePathname();

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

  const missingResponses = useMemo(() => {
    let resultsToCheck = paginatedResults;
    if (isFocusModeOpen) {
      const currentlyFocusedPaper = filteredResults[focusModeIndex];
      if (
        paginatedResults.some((result: any) => result.id !== currentlyFocusedPaper.id)
      ) {
        resultsToCheck = [currentlyFocusedPaper];
      }
    }
    return generateMissingScreeningCombinationsByPaper(
      resultsToCheck,
      currentSearchResult?.screeningQuestions || [],
      currentSearchResult?.screeningResponses || {}
    );
  }, [
    paginatedResults,
    currentSearchResult?.screeningQuestions,
    currentSearchResult?.screeningResponses,
    isFocusModeOpen,
    focusModeIndex,
    filteredResults,
  ]);

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
    <ScreeningContext.Provider
      value={{
        missingResponses,
        loadingResponses: combinationLoading,
        existingResponses: currentSearchResult?.screeningResponses || {},
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
      <div className="space-y-6">
        {/* New Search Command Center */}
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

        {/* Updating Results Animation */}
        <AnimatePresence>
          {isValidating && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 30,
              }}
              className="overflow-hidden"
            >
              <div className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border border-primary/20 rounded-xl p-4 relative overflow-hidden">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  <div className="flex-1">
                    <p className="font-medium text-foreground">Updating results...</p>
                    <p className="text-sm text-muted-foreground">
                      Applying your search parameters
                    </p>
                  </div>
                </div>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: "100%" }}
                  transition={{ duration: 2, ease: "easeInOut" }}
                  className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-primary/50 via-primary to-primary/50"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Papers List */}
        <PapersList
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
      </div>
    </ScreeningContext.Provider>
  );
}
