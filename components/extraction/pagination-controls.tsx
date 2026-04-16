/** Pagination controls for the workbench: "Showing X-Y of Z papers" + Previous/Next buttons. Phase 103: D-18, WB-09. */
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Table as TanStackTable } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import type { WorkbenchPaper } from "@/lib/extraction/workbench-columns";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PaginationControlsProps {
  table: TanStackTable<WorkbenchPaper>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PaginationControls({ table }: PaginationControlsProps) {
  const t = useTranslations("extraction.workbench");
  const { pageIndex, pageSize } = table.getState().pagination;
  const filteredTotal = table.getFilteredRowModel().rows.length;
  const rangeStart = filteredTotal === 0 ? 0 : pageIndex * pageSize + 1;
  const rangeEnd = Math.min((pageIndex + 1) * pageSize, filteredTotal);
  const totalPages = table.getPageCount();

  return (
    <div
      className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
      aria-live="polite"
    >
      <p className="text-sm font-semibold text-muted-foreground">
        {t("paginationShowing", { start: rangeStart, end: rangeEnd, total: filteredTotal })}
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="rounded-xl h-11"
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            {t("paginationPrevious")}
          </Button>
          <span className="min-w-[110px] text-center text-sm text-muted-foreground">
            {pageIndex + 1} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="rounded-xl h-11"
          >
            {t("paginationNext")}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
