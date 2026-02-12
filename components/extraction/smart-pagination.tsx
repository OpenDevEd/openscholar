"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";

interface SmartPaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  totalCount: number;
  filteredCount: number;
  displayedCount: number;
}

export function SmartPagination({
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  totalCount,
  filteredCount,
}: SmartPaginationProps) {
  const t = useTranslations('pagination');
  const startIdx = (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, filteredCount);

  if (filteredCount === 0) {
    return null;
  }

  // Generate page numbers matching CommandCenterPagination pattern
  const getPageNumbers = () => {
    const pages: (number | "ellipsis")[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);

      if (currentPage > 3) {
        pages.push("ellipsis");
      }

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

      if (!pages.includes(totalPages)) {
        pages.push(totalPages);
      }
    }

    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6">
      {/* Left: Results info */}
      <p className="text-sm text-muted-foreground">
        Showing{" "}
        <span className="font-medium text-foreground">
          {startIdx}-{endIdx}
        </span>{" "}
        of{" "}
        <span className="font-medium text-foreground">{filteredCount}</span>{" "}
        papers
        {filteredCount < totalCount && (
          <span className="text-xs ml-2">(filtered from {totalCount})</span>
        )}
      </p>

      {/* Center: Page navigation */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">Previous page</span>
          </Button>

          {getPageNumbers().map((page, index) =>
            page === "ellipsis" ? (
              <span
                key={`ellipsis-${index}`}
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
                  "h-9 w-9",
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
            className="h-9 w-9"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
            <span className="sr-only">Next page</span>
          </Button>
        </div>
      )}

      {/* Right: Page size selector */}
      <Select
        value={pageSize.toString()}
        onValueChange={(v) => onPageSizeChange(Number(v))}
      >
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="25">{t('perPage', { count: 25 })}</SelectItem>
          <SelectItem value="50">{t('perPage', { count: 50 })}</SelectItem>
          <SelectItem value="100">{t('perPage', { count: 100 })}</SelectItem>
          <SelectItem value="200">{t('perPage', { count: 200 })}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
