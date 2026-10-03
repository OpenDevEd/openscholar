"use client";

import { ChevronLeft, ChevronRight } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LIST_FILTER } from "@/components/evidence-libraries/list-controls";
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
  displayedCount,
}: SmartPaginationProps) {
  const t = useTranslations('pagination');
  const startIdx = (currentPage - 1) * pageSize + 1;
  const endIdx =
    displayedCount === 0
      ? 0
      : Math.min(startIdx + displayedCount - 1, filteredCount);

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
    <div className="flex flex-col items-center justify-between gap-3 border-t border-border/50 px-4 py-3 sm:flex-row md:px-6">
      {/* Left: Results info */}
      <p className="text-xs tabular-nums text-muted-foreground">
        {t("showingRange", { start: startIdx, end: endIdx, total: filteredCount })}
        {filteredCount < totalCount && (
          <span className="text-xs ml-2">{t("filteredFrom", { total: totalCount })}</span>
        )}
      </p>

      {/* Center: Page navigation */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">{t("previousPage")}</span>
          </Button>

          {getPageNumbers().map((page, index) =>
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
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
            <span className="sr-only">{t("nextPage")}</span>
          </Button>
        </div>
      )}

      {/* Right: Page size selector */}
      <Select
        value={pageSize.toString()}
        onValueChange={(v) => onPageSizeChange(Number(v))}
      >
        <SelectTrigger size="sm" aria-label={t("perPage", { count: pageSize })} className={cn("w-36", LIST_FILTER)}>
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
