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
import { useResultsStore, useUIStore } from "@/lib/store";
import { ResultsFilter } from "./results-filter";
import { PaperCard } from "./paper-card";

interface ResultsListProps {
  onDownloadItem: (item: any, format: 'json' | 'csv') => void;
  onDownloadEssentialItem: (item: any, format: 'json' | 'csv') => void;
  onOpenFocusMode: () => void;
}

export function ResultsList({ 
  onDownloadItem, 
  onDownloadEssentialItem, 
  onOpenFocusMode 
}: ResultsListProps) {
  const {
    results,
    currentPage,
    resultsFilter,
    setCurrentPage,
    setResultsFilter
  } = useResultsStore();
  
  const { isLoadingResults } = useUIStore();
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Filter results based on search term
  const filteredResults = results.filter(result => {
    if (!resultsFilter.trim()) return true;
    
    const searchTerm = resultsFilter.toLowerCase();
    return (
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
  };

  const handleFilterChange = (value: string) => {
    setResultsFilter(value);
  };

  return (
    <div className="flex flex-col md:h-auto h-full">
      <ResultsFilter 
        value={resultsFilter}
        onChange={handleFilterChange}
        filteredCount={filteredResults.length}
        totalCount={results.length}
      />
      
      <div className="flex-1 overflow-y-auto md:max-h-[60vh]" ref={resultsContainerRef}>
        <div className="space-y-4">
          {isLoadingResults ? (
            <div className="flex justify-center items-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
              {paginatedResults.map((result, index) => (
                <PaperCard
                  key={index}
                  result={result}
                  onDownloadItem={onDownloadItem}
                  onDownloadEssentialItem={onDownloadEssentialItem}
                  onOpenFocusMode={onOpenFocusMode}
                />
              ))}
              {paginatedResults.length === 0 && (
                <p className="text-center text-muted-foreground py-4">
                  {resultsFilter ? 'No results match your search' : 'No results found'}
                </p>
              )}
            </>
          )}
        </div>
      </div>
      
      {filteredResults.length > 0 && (
        <div className="flex-shrink-0 pt-4 md:pt-4 border-t md:border-t-0">
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
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                (page) => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      onClick={() => handlePageChange(page)}
                      isActive={currentPage === page}
                      className="cursor-pointer"
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationNext
                  onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
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