import React, { useRef, useEffect } from 'react';
import { Loader2 } from "lucide-react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import { ITEMS_PER_PAGE } from "@/lib/constants";
import { useResultsStore, useUIStore, useSearchFormStore, useRatingsStore } from "@/lib/store";
import { ResultsFilter } from "./results-filter";
import { PaperCard } from "./paper-card";

interface ResultsListProps {
  onDownloadItem: (item: any, format: 'json' | 'csv') => void;
  onDownloadEssentialItem: (item: any, format: 'json' | 'csv') => void;
}

export function ResultsList({ 
  onDownloadItem, 
  onDownloadEssentialItem
}: ResultsListProps) {
  const {
    results,
    totalCount,
    currentPage,
    resultsFilter,
    setCurrentPage,
    setResultsFilter
  } = useResultsStore();
  
  const { isLoadingResults } = useUIStore();
  const { ratingRange, isRatingFilterActive, onlyRatedPapers } = useSearchFormStore();
  const { ratings } = useRatingsStore();
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Filter results based on search term and rating filter
  const filteredResults = results.filter(result => {
    // Text search filter
    if (resultsFilter.trim()) {
      const searchTerm = resultsFilter.toLowerCase();
      const matchesText = (
        result.title?.toLowerCase().includes(searchTerm) ||
        result.abstract?.toLowerCase().includes(searchTerm) ||
        result.authorships?.some((authorship: any) => 
          authorship.author?.display_name?.toLowerCase().includes(searchTerm)
        ) ||
        result.primary_topic?.display_name?.toLowerCase().includes(searchTerm) ||
        result.primary_topic?.subfield?.display_name?.toLowerCase().includes(searchTerm) ||
        result.primary_topic?.field?.display_name?.toLowerCase().includes(searchTerm) ||
        result.primary_topic?.domain?.display_name?.toLowerCase().includes(searchTerm)
      );
      
      if (!matchesText) return false;
    }
    
    // Rating filter
    if (isRatingFilterActive && onlyRatedPapers) {
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

  const totalPages = Math.ceil(filteredResults.length / ITEMS_PER_PAGE);
  const paginatedResults = filteredResults.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  // Notify Zotero when results are rendered/rerendered
  useEffect(() => {
    if (paginatedResults.length > 0) {
      document.dispatchEvent(new Event('ZoteroItemUpdated', {
        bubbles: true,
        cancelable: true
      }));
    }
  }, [paginatedResults]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    resultsContainerRef.current?.scrollTo(0, 0);
    // Scroll to top of page on page change
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFilterChange = (value: string) => {
    setResultsFilter(value);
  };

  return (
    <div className="space-y-6">
      <ResultsFilter 
        value={resultsFilter}
        onChange={handleFilterChange}
        filteredCount={filteredResults.length}
        totalCount={totalCount}
      />
      
      <div ref={resultsContainerRef}>
        {isLoadingResults ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="ml-2 text-muted-foreground">Loading results...</span>
          </div>
        ) : (
          <div className="space-y-6">
            {paginatedResults.map((result, index) => (
              <PaperCard
                key={`${result.id}-${index}`}
                result={result}
                onDownloadItem={onDownloadItem}
                onDownloadEssentialItem={onDownloadEssentialItem}
              />
            ))}
            {paginatedResults.length === 0 && (
              <div className="text-center py-12">
                <p className="text-lg text-muted-foreground">
                  {resultsFilter || isRatingFilterActive ? 'No results match your filters' : 'No results found'}
                </p>
                {(resultsFilter || isRatingFilterActive) && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Try adjusting your search terms or filter settings
                  </p>
                )}
              </div>
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
                  onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                  className={cn(
                    "cursor-pointer",
                    currentPage === 1 && "pointer-events-none opacity-50"
                  )}
                />
              </PaginationItem>
              
              {/* Show page numbers with ellipsis for large page counts */}
              {totalPages <= 7 ? (
                // Show all pages if 7 or fewer
                Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      onClick={() => handlePageChange(page)}
                      isActive={currentPage === page}
                      className="cursor-pointer"
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))
              ) : (
                // Show pages with ellipsis for large page counts
                <>
                  {/* Always show first page */}
                  <PaginationItem>
                    <PaginationLink
                      onClick={() => handlePageChange(1)}
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
                      const page = Math.max(2, Math.min(totalPages - 1, currentPage - 2 + i));
                      return page;
                    }
                  )
                    .filter((page, index, array) => array.indexOf(page) === index) // Remove duplicates
                    .filter(page => page > 1 && page < totalPages) // Exclude first and last
                    .map((page) => (
                      <PaginationItem key={page}>
                        <PaginationLink
                          onClick={() => handlePageChange(page)}
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
                        onClick={() => handlePageChange(totalPages)}
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
                  onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                  className={cn(
                    "cursor-pointer",
                    currentPage === totalPages && "pointer-events-none opacity-50"
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