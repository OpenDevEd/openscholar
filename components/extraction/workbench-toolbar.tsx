/** Horizontal toolbar with search input, filter groups, view switcher, column visibility toggle, and export dropdown. Phase 101: WB-03, WB-10. Phase 103: D-15 (search), D-16 (debounce), D-19 (filtered export), D-20 (export dropdown). */
"use client";

import { useState, useEffect, useCallback, useDeferredValue } from "react";
import type {
  Table as TanStackTable,
  ColumnFiltersState,
} from "@tanstack/react-table";
import {
  Filter,
  BarChart3,
  Calendar,
  Building2,
  Search,
  X,
  Download,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useConvex } from "convex/react";
import { FilterSection } from "@/components/shared/filter-section";
import { ViewSwitcher } from "@/components/extraction/view-switcher";
import { ColumnVisibilityToggle } from "@/components/extraction/column-visibility-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useExtractionResultsViewStore } from "@/lib/store/extraction-results-view";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import {
  exportExtractionToCSV,
  exportExtractionToJSON,
  exportExtractionToXLSX,
} from "@/lib/extraction/export";
import type { ExtractionExportData } from "@/lib/extraction/export";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { showStyledToast } from "@/components/ui/sonner";
import type { WorkbenchPaper } from "@/lib/extraction/workbench-columns";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isColumnFilterActive(
  columnFilters: ColumnFiltersState,
  columnId: string,
): boolean {
  return columnFilters.some(
    (f) => f.id === columnId && f.value !== "" && f.value !== undefined,
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface WorkbenchToolbarProps {
  table: TanStackTable<WorkbenchPaper>;
  jobId?: string;
  jobStatus?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkbenchToolbar({ table, jobId, jobStatus }: WorkbenchToolbarProps) {
  const t = useTranslations("extraction");
  const convex = useConvex();
  const { activeView, setActiveView } = useExtractionResultsViewStore();
  const columnFilters = table.getState().columnFilters;

  // ---------------------------------------------------------------------------
  // Search input with layered debounce (D-15, D-16)
  // ---------------------------------------------------------------------------

  const globalFilter = table.getState().globalFilter as string;
  const [searchInput, setSearchInput] = useState(globalFilter);
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const deferredSearch = useDeferredValue(debouncedSearch);

  useEffect(() => {
    table.setGlobalFilter(deferredSearch);
  }, [deferredSearch, table]);

  // ---------------------------------------------------------------------------
  // Export dropdown (D-19, D-20, D-24)
  // ---------------------------------------------------------------------------

  const [isExporting, setIsExporting] = useState(false);

  const filteredPaperIds = table
    .getFilteredRowModel()
    .rows.map((row) => row.original._id);

  const hasActiveFilters =
    globalFilter !== "" || columnFilters.length > 0;

  const handleExport = useCallback(
    async (fmt: "csv" | "json" | "xlsx") => {
      if (!jobId) return;
      setIsExporting(true);
      try {
        const exportData = await convex.query(
          api.extraction.queries.getExtractionResultsForExport,
          {
            jobId: jobId as Id<"extractionJobs">,
            ...(hasActiveFilters
              ? { paperIds: filteredPaperIds as Id<"extractionPapers">[] }
              : {}),
          },
        );
        if (!exportData) return;
        switch (fmt) {
          case "csv":
            exportExtractionToCSV(exportData as ExtractionExportData);
            break;
          case "json":
            exportExtractionToJSON(exportData as ExtractionExportData);
            break;
          case "xlsx":
            await exportExtractionToXLSX(exportData as ExtractionExportData);
            break;
        }
      } catch (err) {
        console.error("Export failed:", err);
        showStyledToast("error", t("export.exportFailed"));
      } finally {
        setIsExporting(false);
      }
    },
    [jobId, convex, hasActiveFilters, filteredPaperIds, t],
  );

  return (
    <div className="bg-card/80 backdrop-blur-sm border-b border-border/40 px-4 py-3 flex items-center gap-4 flex-wrap">
      {/* View switcher */}
      <ViewSwitcher value={activeView} onChange={setActiveView} />

      <Separator orientation="vertical" className="h-6" />

      {/* Search input (D-15) */}
      <div className="relative flex-1 min-w-[200px] max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("workbench.searchPlaceholder")}
          className="pl-9 pr-8"
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted"
            aria-label={t("workbench.searchClear")}
          >
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      <Separator orientation="vertical" className="h-6" />

      {/* Status filter */}
      <FilterSection
        title={t("workbench.filterStatus")}
        icon={Filter}
        isActive={isColumnFilterActive(columnFilters, "status")}
        onClear={() => table.getColumn("status")?.setFilterValue(undefined)}
      >
        <Select
          value={
            (table.getColumn("status")?.getFilterValue() as string) ?? ""
          }
          onValueChange={(val) =>
            table.getColumn("status")?.setFilterValue(val || undefined)
          }
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={t("workbench.filterStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="parsing">Parsing</SelectItem>
            <SelectItem value="extracting">Extracting</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </FilterSection>

      {/* Confidence filter */}
      <FilterSection
        title={t("workbench.filterConfidence")}
        icon={BarChart3}
        isActive={isColumnFilterActive(columnFilters, "confidence")}
        onClear={() =>
          table.getColumn("confidence")?.setFilterValue(undefined)
        }
      >
        <Select
          value={
            (table.getColumn("confidence")?.getFilterValue() as string) ?? ""
          }
          onValueChange={(val) =>
            table
              .getColumn("confidence")
              ?.setFilterValue(val || undefined)
          }
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={t("workbench.filterConfidence")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="high">{t("confidenceHigh")}</SelectItem>
            <SelectItem value="medium">{t("confidenceMedium")}</SelectItem>
            <SelectItem value="low">{t("confidenceLow")}</SelectItem>
          </SelectContent>
        </Select>
      </FilterSection>

      {/* Year filter */}
      <FilterSection
        title={t("workbench.filterYear")}
        icon={Calendar}
        isActive={isColumnFilterActive(columnFilters, "year")}
        onClear={() => table.getColumn("year")?.setFilterValue(undefined)}
      >
        <Input
          placeholder={t("workbench.yearPlaceholder")}
          value={
            (table.getColumn("year")?.getFilterValue() as string) ?? ""
          }
          onChange={(e) =>
            table
              .getColumn("year")
              ?.setFilterValue(e.target.value || undefined)
          }
          className="h-8 text-sm"
        />
      </FilterSection>

      {/* Venue filter */}
      <FilterSection
        title={t("workbench.filterVenue")}
        icon={Building2}
        isActive={isColumnFilterActive(columnFilters, "venue")}
        onClear={() => table.getColumn("venue")?.setFilterValue(undefined)}
      >
        <Input
          placeholder={t("workbench.venuePlaceholder")}
          value={
            (table.getColumn("venue")?.getFilterValue() as string) ?? ""
          }
          onChange={(e) =>
            table
              .getColumn("venue")
              ?.setFilterValue(e.target.value || undefined)
          }
          className="h-8 text-sm"
        />
      </FilterSection>

      <Separator orientation="vertical" className="h-6" />

      {/* Column visibility toggle */}
      <ColumnVisibilityToggle table={table} />

      {/* Export dropdown (D-19, D-20) */}
      {jobId && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {t("workbench.exportButton")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {jobStatus !== "completed" && (
              <div className="px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1.5 border-b border-border/40 mb-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {t("export.incompleteWarning")}
              </div>
            )}
            {hasActiveFilters && (
              <div className="px-2 py-1.5 text-[11px] text-muted-foreground border-b border-border/40 mb-1">
                {t("workbench.exportFilteredNote", { count: filteredPaperIds.length })}
              </div>
            )}
            <DropdownMenuItem onClick={() => handleExport("csv")}>CSV</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("json")}>JSON</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("xlsx")}>XLSX</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
