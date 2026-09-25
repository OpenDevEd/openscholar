"use client";

import type { DateRange } from "react-day-picker";
import { SegmentedToggle } from "./segmented-toggle";
import { useTranslations } from "next-intl";
import { DateRangePicker } from "@/components/shared/date-range-picker";
import { YearRangePicker } from "@/components/year-range-picker";
import { cn } from "@/lib/utils";

interface PublicationTimeframeFilterProps {
  /** Current filter mode */
  filterType: "year" | "date";
  onFilterTypeChange: (type: "year" | "date") => void;

  /** Year range mode */
  yearRange: [number, number];
  onYearRangeChange: (range: [number, number]) => void;
  isYearEnabled: boolean;
  onYearToggleEnabled: (enabled: boolean) => void;

  /** Date range mode */
  dateRange: DateRange | undefined;
  onDateRangeChange: (range: DateRange | undefined) => void;

  /** Whether the overall filter is active (for trigger button styling) */
  isActive: boolean;
}

/**
 * Shared publication timeframe filter with year/date segmented toggle.
 *
 * Used identically by both the search results sidebar and the library sidebar.
 * In year mode: renders YearRangePicker with enable/disable toggle.
 * In date mode: renders DateRangePicker with calendar.
 */
export function PublicationTimeframeFilter({
  filterType,
  onFilterTypeChange,
  yearRange,
  onYearRangeChange,
  isYearEnabled,
  onYearToggleEnabled,
  dateRange,
  onDateRangeChange,
  isActive,
}: PublicationTimeframeFilterProps) {
  const tf = useTranslations("searchFilters");

  return (
    <div className="space-y-3">
      {/* Year / Date segmented toggle */}
      <SegmentedToggle
        ariaLabel={tf("publicationTimeframe")}
        value={filterType}
        onChange={onFilterTypeChange}
        options={[
          { value: "year", label: tf("yearRange") },
          { value: "date", label: tf("dateRange") },
        ]}
      />

      {/* Active picker */}
      {filterType === "date" ? (
        <DateRangePicker
          value={dateRange}
          onValueChange={onDateRangeChange}
        />
      ) : (
        <YearRangePicker
          yearRange={yearRange}
          onYearRangeChange={onYearRangeChange}
          isEnabled={isYearEnabled}
          onToggleEnabled={onYearToggleEnabled}
          showToggle
          isActive={isActive}
        />
      )}
    </div>
  );
}
