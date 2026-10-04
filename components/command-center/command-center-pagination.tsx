"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NumberedPages {
  className?: string;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems: number;
  itemsPerPage: number;
  itemLabel: string;
}

/**
 * A list read a cursor page at a time: previous and next around "page / pages", and the
 * range from where the page really starts, since a page can't be jumped to. Without `total`
 * (a search, whose matches aren't counted) both read "at least", until the last page.
 */
interface SteppedPages {
  className?: string;
  currentPage: number;
  itemLabel: string;
  steps: { canPrevious: boolean; canNext: boolean; onPrevious: () => void; onNext: () => void; offset: number; shown: number; total?: number; pageCount?: number };
}

/**
 * Shared pagination component for command centers.
 * Shows page info, page numbers, and prev/next buttons.
 */
export function CommandCenterPagination(props: NumberedPages | SteppedPages) {
  const { currentPage, itemLabel } = props;
  const steps = "steps" in props ? props.steps : undefined;
  const { totalPages = 1, itemsPerPage = 1, onPageChange = () => {}, totalItems: counted = 0 }: Partial<NumberedPages> = "steps" in props ? {} : props;
  const tc = useTranslations("common");
  const atLeast = (shown: number) => (steps?.canNext ? `${shown}+` : shown);
  const startItem = steps ? steps.offset + 1 : (currentPage - 1) * itemsPerPage + 1;
  const endItem = steps ? steps.offset + steps.shown : Math.min(currentPage * itemsPerPage, counted);
  const totalItems = steps ? (steps.total ?? atLeast(endItem)) : counted;

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | "ellipsis")[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      if (currentPage > 3) {
        pages.push("ellipsis");
      }

      // Show pages around current
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) {
          pages.push(i);
        }
      }

      if (currentPage < totalPages - 2) {
        pages.push("ellipsis");
      }

      // Always show last page
      if (!pages.includes(totalPages)) {
        pages.push(totalPages);
      }
    }

    return pages;
  };

  return (
    <div className={cn("flex flex-col sm:flex-row items-center justify-between gap-4 pt-6", props.className)}>
      {/* Info text */}
      <p className="text-xs tabular-nums text-muted-foreground">
        {tc("showingStartEnd", { start: startItem, end: endItem, total: totalItems, label: itemLabel })}
      </p>

      {/* Pagination controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => (steps ? steps.onPrevious() : onPageChange(currentPage - 1))}
          disabled={steps ? !steps.canPrevious : currentPage === 1}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="sr-only">{tc("previousPage")}</span>
        </Button>

        {steps ? (
          <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">
            {currentPage} / {steps.pageCount === undefined ? atLeast(currentPage) : Math.max(currentPage, steps.pageCount)}
          </span>
        ) : getPageNumbers().map((page, index) =>
          page === "ellipsis" ? (
            <span
              key={index === 1 ? "ellipsis-start" : "ellipsis-end"}
              className="px-2 text-muted-foreground"
            >
              ...
            </span>
          ) : (
            <Button
              key={page}
              variant={currentPage === page ? "default" : "outline"}
              size="icon"
              className={cn(
                "size-8 tabular-nums",
                currentPage === page && "pointer-events-none"
              )}
              onClick={() => onPageChange(page)}
            >
              {page}
            </Button>
          )
        )}

        <Button
          variant="outline"
          size="icon"
          className="size-8"
          onClick={() => (steps ? steps.onNext() : onPageChange(currentPage + 1))}
          disabled={steps ? !steps.canNext : currentPage === totalPages}
        >
          <ChevronRight className="h-4 w-4" />
          <span className="sr-only">{tc("nextPage")}</span>
        </Button>
      </div>
    </div>
  );
}
