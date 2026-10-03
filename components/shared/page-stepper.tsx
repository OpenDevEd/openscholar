"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const STEP_CLASS =
  "p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none transition-colors";

/**
 * Previous and next around "page / pages", for a list read a cursor page at a time. Without
 * `pageCount` (a search, whose matches aren't counted) it shows the page alone.
 */
export function PageStepper({
  page,
  pageCount,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  className,
}: {
  page: number;
  pageCount?: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  className?: string;
}) {
  const t = useTranslations("pagination");
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <button type="button" aria-label={t("previousPage")} disabled={!canPrevious} onClick={onPrevious} className={STEP_CLASS}>
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {pageCount === undefined ? page : `${page} / ${Math.max(page, pageCount)}`}
      </span>
      <button type="button" aria-label={t("nextPage")} disabled={!canNext} onClick={onNext} className={STEP_CLASS}>
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
