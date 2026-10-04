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
  /** The page shown, from 1; the results are read a page at a time, so a page can't be jumped to. */
  currentPage: number;
  pageSize: number;
  /** Whether the results run past one page; it holds while the next page loads, so the steps stay up. */
  hasPages: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (pageSize: number) => void;
  totalCount: number;
  filteredCount: number;
  /** The counts are a view behind, still being counted for the filters now set. */
  stale?: boolean;
  /** How many papers the pages before this one held. */
  offset: number;
  displayedCount: number;
}

export function SmartPagination({
  currentPage,
  pageSize,
  hasPages,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onPageSizeChange,
  totalCount,
  filteredCount,
  stale,
  offset,
  displayedCount,
}: SmartPaginationProps) {
  const t = useTranslations('pagination');
  const endIdx = offset + displayedCount;
  const pageCount = Math.max(currentPage, Math.ceil(filteredCount / pageSize));

  return (
    <div className={cn("flex flex-col items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 sm:flex-row md:px-6", stale && "pointer-events-none opacity-60")}>
      {/* Left: Results info */}
      {/* The sides share the row evenly, so the steps stay put when the count's text changes width. */}
      <p className="text-xs tabular-nums text-muted-foreground sm:flex-1">
        {t("showingRange", { start: displayedCount === 0 ? 0 : offset + 1, end: endIdx, total: Math.max(filteredCount, endIdx) })}
        {filteredCount < totalCount && (
          <span className="text-xs ml-2">{t("filteredFrom", { total: totalCount })}</span>
        )}
      </p>

      {/* Center: Page navigation */}
      {hasPages && (
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-8" onClick={onPrevious} disabled={!canPrevious}>
            <ChevronLeft className="h-4 w-4" />
            <span className="sr-only">{t("previousPage")}</span>
          </Button>
          <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">
            {currentPage} / {pageCount}
          </span>
          <Button variant="outline" size="icon" className="size-8" onClick={onNext} disabled={!canNext}>
            <ChevronRight className="h-4 w-4" />
            <span className="sr-only">{t("nextPage")}</span>
          </Button>
        </div>
      )}

      {/* Right: Page size selector */}
      <div className="flex sm:flex-1 sm:justify-end">
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
    </div>
  );
}
