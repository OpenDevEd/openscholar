/** Horizontal toolbar with filter groups, view switcher, and column visibility toggle. Each filter wrapped in FilterSection per WB-10. Phase 101: WB-03, WB-10. */
"use client";

import type {
  Table as TanStackTable,
  ColumnFiltersState,
} from "@tanstack/react-table";
import { Filter, BarChart3, Calendar, Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
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
import { Separator } from "@/components/ui/separator";
import { useExtractionResultsViewStore } from "@/lib/store/extraction-results-view";
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
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkbenchToolbar({ table }: WorkbenchToolbarProps) {
  const t = useTranslations("extraction");
  const { activeView, setActiveView } = useExtractionResultsViewStore();
  const columnFilters = table.getState().columnFilters;

  return (
    <div className="bg-card/80 backdrop-blur-sm border-b border-border/40 px-4 py-3 flex items-center gap-4 flex-wrap">
      {/* View switcher */}
      <ViewSwitcher value={activeView} onChange={setActiveView} />

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
    </div>
  );
}
