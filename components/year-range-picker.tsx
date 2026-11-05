"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { focusContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { MIN_YEAR, getYearRangePresets } from "@/lib/constants";
import { Slider } from "@/components/ui/slider";
import { useTranslations } from "next-intl";
import { PresetStrip } from "@/components/shared/date-range-picker";

interface YearRangePickerProps {
  /** Current year range tuple */
  yearRange: [number, number];
  /** Called when the range changes */
  onYearRangeChange: (range: [number, number]) => void;
  /** Whether the year range filter is on */
  isEnabled: boolean;
  /** Turns the filter on or off. Off clears the range. */
  onToggleEnabled: (enabled: boolean) => void;
  /** Override active state for the trigger button display */
  isActive?: boolean;
}

/**
 * Shared year range picker with Popover, Slider, Input fields, and presets.
 * The filter turns on with the first range picked. The enclosing FilterSection's Clear turns it off.
 *
 * Accepts value+onChange props so it can be used by both the search results
 * page (via context hooks) and the library page (via nuqs URL params).
 */
export function YearRangePicker({
  yearRange,
  onYearRangeChange,
  isEnabled,
  onToggleEnabled,
  isActive: isActiveProp,
}: YearRangePickerProps) {
  const tf = useTranslations("searchFilters");
  const tc = useTranslations("common");

  const currentYear = new Date().getFullYear();
  const isFilterActive =
    isActiveProp ??
    (isEnabled &&
      (yearRange[0] !== MIN_YEAR || yearRange[1] !== currentYear));

  const [isOpen, setIsOpen] = React.useState(false);

  // Local input state so manual typing doesn't immediately get overridden
  const [fromInput, setFromInput] = React.useState(yearRange[0].toString());
  const [toInput, setToInput] = React.useState(yearRange[1].toString());

  const syncInputsToRange = React.useCallback((range: [number, number]) => {
    setFromInput(range[0].toString());
    setToInput(range[1].toString());
  }, []);

  React.useEffect(() => {
    syncInputsToRange(yearRange);
  }, [syncInputsToRange, yearRange[0], yearRange[1]]);

  const clampYear = React.useCallback(
    (value: number) => Math.min(currentYear, Math.max(MIN_YEAR, value)),
    [currentYear],
  );

  const commitYearRange = React.useCallback(
    (nextRange: [number, number]) => {
      const clampedFrom = clampYear(nextRange[0]);
      const clampedTo = clampYear(nextRange[1]);
      const normalizedRange: [number, number] =
        clampedFrom <= clampedTo
          ? [clampedFrom, clampedTo]
          : [clampedTo, clampedTo];
      syncInputsToRange(normalizedRange);
      // Every year is no filter at all.
      if (normalizedRange[0] === MIN_YEAR && normalizedRange[1] === currentYear) {
        if (isEnabled) onToggleEnabled(false);
        return;
      }
      // Order matters. `updateFilter` reads a stale URL snapshot per call, and the
      // enable path re-derives yf/yt from the OLD range when none is passed. So an
      // enable issued AFTER the range clobbers it with the default range. Enable
      // first, so the range is the last (winning) write.
      if (!isEnabled) onToggleEnabled(true);
      onYearRangeChange(normalizedRange);
    },
    [clampYear, currentYear, isEnabled, onToggleEnabled, onYearRangeChange, syncInputsToRange],
  );

  const commitFromInput = React.useCallback(
    (rawValue: string) => {
      // Tabbing through an unchanged field changes nothing.
      if (rawValue === yearRange[0].toString()) return;
      const parsedValue = Number.parseInt(rawValue, 10);
      if (Number.isNaN(parsedValue)) {
        commitYearRange([MIN_YEAR, yearRange[1]]);
        return;
      }
      const clampedValue = clampYear(parsedValue);
      if (clampedValue > yearRange[1]) {
        commitYearRange([yearRange[1], yearRange[1]]);
        return;
      }
      commitYearRange([clampedValue, yearRange[1]]);
    },
    [clampYear, commitYearRange, yearRange],
  );

  const commitToInput = React.useCallback(
    (rawValue: string) => {
      if (rawValue === yearRange[1].toString()) return;
      const parsedValue = Number.parseInt(rawValue, 10);
      if (Number.isNaN(parsedValue)) {
        commitYearRange([yearRange[0], currentYear]);
        return;
      }
      const clampedValue = clampYear(parsedValue);
      if (clampedValue < yearRange[0]) {
        commitYearRange([yearRange[0], yearRange[0]]);
        return;
      }
      commitYearRange([yearRange[0], clampedValue]);
    },
    [clampYear, commitYearRange, currentYear, yearRange],
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full h-10 justify-start text-start font-normal transition-all duration-200",
            isFilterActive
              ? "border-sidebar-primary/50"
              : "border-dashed border-muted-foreground/30 dark:border-muted-foreground/20",
          )}
        >
          <span className="truncate">
            {isFilterActive
              ? `${yearRange[0]} → ${yearRange[1]}`
              : tf("chooseYearRange")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) space-y-4 p-4" align="start" onOpenAutoFocus={focusContent}>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{tc("from")}</span>
            <Input
              type="number"
              min={MIN_YEAR}
              max={currentYear}
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              onBlur={(e) => commitFromInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                e.currentTarget.blur();
              }}
              className="h-9 text-sm"
              placeholder={MIN_YEAR.toString()}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{tc("to")}</span>
            <Input
              type="number"
              min={MIN_YEAR}
              max={currentYear}
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              onBlur={(e) => commitToInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                e.currentTarget.blur();
              }}
              className="h-9 text-sm"
              placeholder={currentYear.toString()}
            />
          </label>
        </div>

        <Slider
          value={yearRange}
          onValueChange={(values) => commitYearRange([values[0], values[1]])}
          min={MIN_YEAR}
          max={currentYear}
          step={1}
          className="w-full"
        />

        <PresetStrip
          label={tf("quickPresets")}
          columns={2}
          options={getYearRangePresets().map((preset) => ({ key: preset.key, label: tf(preset.key) }))}
          active={isEnabled ? (getYearRangePresets().find((preset) => preset.range[0] === yearRange[0] && preset.range[1] === yearRange[1])?.key ?? null) : null}
          onPick={(key) => commitYearRange(getYearRangePresets().find((preset) => preset.key === key)!.range)}
        />
      </PopoverContent>
    </Popover>
  );
}
