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
import { ScreeningQuestions } from "./screening-questions";
import { ITEMS_PER_PAGE } from "@/lib/constants";
import {
  useResultsStore,
  useRatingsStore,
  useSearchHistoryStore,
  useAIConfigStore,
} from "@/lib/store";
import { ResultsFilter } from "./results-filter";
import { PaperCard } from "./paper-card";
import { useCurrentSearchFormState, useSearchResults } from "@/lib/hooks";
import {
  SearchBar,
  ResearchQuestionBar,
  ResultsActionBar,
  useSearchBarLogic,
} from "./navbar";
import {
  Loader2,
  Search,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  enhanceSearchQuery,
  generateScreeningResponses,
} from "@/app/actions/ai-enhance";
import { Card, CardContent } from "./ui/card";
import { generateMissingScreeningCombinationsByPaper } from "@/lib/screening-utils";
import { ScreeningResponses } from "@/lib/types";
import { validateAndExpandKeywordsSilently } from "@/lib/keyword-validation";

interface PapersListProps {
  results: any[];
  filteredResults: any[];
  paginatedResults: any[];
  resultsFilter: string;
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
}>({});

function PapersList({
  results,
  filteredResults,
  paginatedResults,
  resultsFilter,
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

  return (
    <div ref={resultsContainerRef}>
      <div className="space-y-6">
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
            />
          );
        })}
        {paginatedResults.length === 0 && (
          <div className="text-center py-12">
            <p className="text-lg text-muted-foreground">
              {resultsFilter ||
              isRatingFilterActive(ratingRange, onlyRatedPapers)
                ? "No results match your filters"
                : "No results found"}
            </p>
            {(resultsFilter ||
              isRatingFilterActive(ratingRange, onlyRatedPapers)) && (
              <p className="text-sm text-muted-foreground mt-2">
                Try adjusting your search terms or filter settings
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
  const { currentPage, resultsFilter, setCurrentPage, setResultsFilter } =
    useResultsStore();

  const { results, totalCount } = useSearchResults();
  const { ratingRange, onlyRatedPapers } = useCurrentSearchFormState();
  const { ratings } = useRatingsStore();
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [aiInstructions, setAiInstructions] = useState("");
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [queryFlash, setQueryFlash] = useState(false);
  const [isScreening, setIsScreening] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState<string[]>([]);
  const [combinationLoading, setCombinationLoading] = useState<
    Record<string, Record<string, boolean>>
  >({});

  const pathname = usePathname();

  // Get the current search ID from the URL (same logic as hooks.ts)
  const searchId = getEffectiveSearchId(pathname, undefined);

  // Get the current search result using the same selector pattern as hooks.ts
  const currentSearchResult = useSearchHistoryStore((state) =>
    searchId ? state.searchHistory.find((item) => item.id === searchId) : null
  );

  const { setScreeningResponse, setScreeningResponses } = useSearchHistoryStore();

  const {
    currentQuery: storeCurrentQuery,
    setCurrentQuery,
    handleQueryChange,
    handleSubmit,
  } = useSearchBarLogic();
  const { provider, apiKey } = useAIConfigStore();

  // Use the queryHistory from the current search result (same as search-history.tsx)
  const queryHistory = currentSearchResult?.queryHistory || [];

  // Navigation state - start with the last index (current query)
  const [historyIndex, setHistoryIndex] = React.useState(
    queryHistory.length > 0 ? queryHistory.length - 1 : 0
  );

  // Update history index when queryHistory changes to stay at the last index (current)
  React.useEffect(() => {
    if (queryHistory.length > 0) {
      setHistoryIndex(queryHistory.length - 1); // Always stay at the last index (current)
    }
  }, [queryHistory.length]);

  // AI Enhancement function
  const handleAiEnhancement = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!aiInstructions.trim() || !storeCurrentQuery.trim()) {
      return;
    }

    setIsEnhancing(true);

    try {
      // Check if AI configuration is available
      if (!apiKey) {
        toast.error("Configuration Required", {
          description:
            "Please configure your AI API key in the settings first.",
        });
        return;
      }

      if (!provider) {
        toast.error("Configuration Required", {
          description: "Please select an AI provider in the settings first.",
        });
        return;
      }

      const { expandedQuery } = validateAndExpandKeywordsSilently(storeCurrentQuery);
      // Create enhanced prompt that includes user instructions
      const enhancedPrompt = `Original query: "${expandedQuery}"

User enhancement instructions: "${aiInstructions}"

Please enhance this academic search query according to the user's specific instructions while following Elasticsearch Query String Query syntax rules.`;

      // Call the AI service with the enhanced prompt
      const response = await enhanceSearchQuery(
        enhancedPrompt,
        provider,
        apiKey,
        currentSearchResult?.language
      );

      // Update the query with the enhanced version
      handleQueryChange(response.enhancedQuery);

      // Trigger green flash effect
      setQueryFlash(true);
      setTimeout(() => setQueryFlash(false), 1000);

      // Show success toast with explanation
      toast.success("Query Enhanced!", {
        description: response.explanation,
      });

      setTimeout(() => {
        document.getElementById("search-bar-submit")?.click();
      }, 100);
    } catch (error) {
      console.error("AI enhancement failed:", error);
      toast.error("Enhancement Failed", {
        description:
          "Failed to enhance query. Please check your API key and try again.",
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  // Navigation functions (switched: Previous goes to newer, Next goes to older)
  const goToPrevious = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      handleQueryChange(queryHistory[prevIndex].query);
    }
  };

  const goToNext = () => {
    if (historyIndex < queryHistory.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      handleQueryChange(queryHistory[nextIndex].query);
    }
  };

  // Determine button states (switched: Previous goes to newer, Next goes to older)
  const canGoPrevious = queryHistory.length > 0 && historyIndex > 0;
  const canGoNext =
    queryHistory.length > 0 && historyIndex < queryHistory.length - 1;

  // Reset to current query (last index is the current)
  const resetToLatest = () => {
    if (queryHistory.length > 0) {
      setHistoryIndex(queryHistory.length - 1);
      handleQueryChange(queryHistory[queryHistory.length - 1].query);
    }
  };

  // Check if current query is different from the current one in history (last index is current)
  const hasUnsavedChanges =
    queryHistory.length > 0 &&
    storeCurrentQuery !== queryHistory[queryHistory.length - 1]?.query;

  // Filter results based on search term and rating filter
  const filteredResults = results.filter((result: any) => {
    // Text search filter
    if (resultsFilter.trim()) {
      const searchTerm = resultsFilter.toLowerCase();
      const matchesText =
        result.title?.toLowerCase().includes(searchTerm) ||
        result.abstract?.toLowerCase().includes(searchTerm) ||
        result.authorships?.some((authorship: any) =>
          authorship.author?.display_name?.toLowerCase().includes(searchTerm)
        ) ||
        result.primary_topic?.display_name
          ?.toLowerCase()
          .includes(searchTerm) ||
        result.primary_topic?.subfield?.display_name
          ?.toLowerCase()
          .includes(searchTerm) ||
        result.primary_topic?.field?.display_name
          ?.toLowerCase()
          .includes(searchTerm) ||
        result.primary_topic?.domain?.display_name
          ?.toLowerCase()
          .includes(searchTerm);

      if (!matchesText) return false;
    }

    // Rating filter
    if (isRatingFilterActive(ratingRange, onlyRatedPapers)) {
      const paperRating = ratings[result.id];

      // If onlyRatedPapers is true, exclude papers without ratings
      if (paperRating === undefined) {
        return false;
      }

      // Filter by rating range (0-5)
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
    return generateMissingScreeningCombinationsByPaper(
      paginatedResults,
      currentSearchResult?.screeningQuestions || [],
      currentSearchResult?.screeningResponses || {}
    );
  }, [
    paginatedResults,
    currentSearchResult?.screeningQuestions,
    currentSearchResult?.screeningResponses,
  ]);

  // Notify Zotero when results are rendered/rerendered
  useEffect(() => {
    if (paginatedResults.length > 0) {
      document.dispatchEvent(
        new Event("ZoteroItemUpdated", {
          bubbles: true,
          cancelable: true,
        })
      );
    }

    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [paginatedResults]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    resultsContainerRef.current?.scrollTo(0, 0);
    // Scroll to top of page on page change
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleFilterChange = (value: string) => {
    setResultsFilter(value);
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
        }
      }}
    >
      <div className="space-y-4">
        {/* Updating Results Animation */}
        <div className="space-y-4">
          {isAdjusting ? (
            <Card>
              <CardContent>
                {/* AI Adjustment Interface */}
                {/* Header with navigation and done button */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-2"
                      onClick={goToPrevious}
                      disabled={!canGoPrevious}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span>Previous</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-2"
                      onClick={goToNext}
                      disabled={!canGoNext}
                    >
                      <span>Next</span>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    {hasUnsavedChanges && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={resetToLatest}
                        className="text-orange-600 border-orange-200 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-800 dark:hover:bg-orange-950/50"
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => setIsAdjusting(false)}
                  >
                    Done
                  </Button>
                </div>

                {/* AI Enhancement Form */}
                <form onSubmit={handleAiEnhancement} className=" mb-6">
                  {/* AI Enhancement Input */}
                  <div>
                    <label
                      htmlFor="ai-instructions"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                    >
                      AI Enhancement Instructions
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id="ai-instructions"
                        placeholder="e.g., 'make this query more specific about machine learning research'"
                        className="flex-1"
                        value={aiInstructions}
                        onChange={(e) => setAiInstructions(e.target.value)}
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        className="px-4"
                        disabled={!aiInstructions.trim() || isEnhancing}
                      >
                        {isEnhancing ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Enhancing...
                          </>
                        ) : (
                          "Go"
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Describe how you'd like the AI to enhance or modify your
                      search query
                    </p>
                  </div>
                </form>

                {/* Current Query Form */}
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Current Query */}
                  <div>
                    <label
                      htmlFor="current-query"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                    >
                      Current Query
                    </label>
                    <Textarea
                      id="current-query"
                      placeholder="No query set..."
                      className={cn(
                        "w-full min-h-[120px] resize-y transition-colors duration-300",
                        queryFlash && "bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-700"
                      )}
                      value={storeCurrentQuery}
                      onChange={(e) => handleQueryChange(e.target.value)}
                    />
                  </div>

                  {/* Search Button */}
                  <div className="flex justify-center">
                    <Button
                      type="submit"
                      size="lg"
                      className="flex items-center gap-2 px-8 py-3"
                      id="search-bar-submit"
                    >
                      <Search className="h-5 w-5" />
                      <span>Search</span>
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <ResearchQuestionBar />
              <SearchBar />
            </div>
          )}
          <ResultsActionBar
            totalCount={totalCount}
            currentQuery={storeCurrentQuery}
            onDownloadAllJSON={onDownloadAllJSON}
            onDownloadAllCSV={onDownloadAllCSV}
            onDownloadAllEssentialJSON={onDownloadAllEssentialJSON}
            onDownloadAllEssentialCSV={onDownloadAllEssentialCSV}
            isAdjusting={isAdjusting}
            setIsAdjusting={setIsAdjusting}
            isScreening={isScreening}
            setIsScreening={setIsScreening}
          />
          {isScreening && (
            <div className="space-y-4">
              <ScreeningQuestions searchId={searchId || ""} />
            </div>
          )}
        </div>
        <motion.div
          animate={{
            height: isValidating ? "auto" : 0,
            marginBottom: isValidating ? 16 : 0,
          }}
          transition={{
            type: "spring",
            stiffness: 400,
            damping: 30,
            duration: 0.4,
          }}
          className="overflow-hidden"
        >
          <AnimatePresence>
            {isValidating && (
              <motion.div
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                  duration: 0.3,
                }}
              >
                <div className="bg-gradient-to-r from-blue-50 via-purple-50 to-pink-50 dark:from-blue-950/30 dark:via-purple-950/30 dark:to-pink-950/30 border border-blue-200/50 dark:border-blue-800/50 rounded-xl p-4 shadow-sm relative overflow-hidden">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                      >
                        <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      </motion.div>
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-blue-900 dark:text-blue-100">
                        Updating results...
                      </p>
                      <p className="text-sm text-blue-700 dark:text-blue-300">
                        Applying your new filters
                      </p>
                    </div>
                  </div>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: "100%" }}
                    transition={{ duration: 1.5, ease: "easeInOut" }}
                    className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
        <PapersList
          results={results}
          filteredResults={filteredResults}
          paginatedResults={paginatedResults}
          resultsFilter={resultsFilter}
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
        />
      </div>
    </ScreeningContext.Provider>
  );
}
