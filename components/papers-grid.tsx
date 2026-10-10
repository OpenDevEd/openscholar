"use client";

/**
 * A page of a search's results as cards, with the pages to move between, as the results list shows
 * them: the cards of the page shown, in the list's order, and the pages of the papers it keeps.
 */
import React from "react";
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
import { ViewMode, type PaperResult } from "@/lib/types";
import { PaperCard } from "./paper-card";
import type { PaperCardHide } from "./paper-card/shared";

interface PapersListProps {
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

export function PapersGrid({
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
          // Its place in the papers kept, in their order, which focus mode opens at.
          const keptIndex = (currentPage - 1) * ITEMS_PER_PAGE + index;
          return (
            <PaperCard
              key={result.id}
              result={result}
              resultIndex={keptIndex}
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
