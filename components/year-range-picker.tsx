"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon, RotateCcw } from "@/components/icons";
import { cn } from "@/lib/utils";
import { MIN_YEAR, getYearRangePresets } from "@/lib/constants";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";

interface YearRangePickerProps {
  /** Current year range tuple */
  yearRange: [number, number];
  /** Called when the range changes */
  onYearRangeChange: (range: [number, number]) => void;
  /** Whether the year range filter is enabled (only relevant when showToggle is true) */
  isEnabled?: boolean;
  /** Called when the enable/disable toggle changes */
  onToggleEnabled?: (enabled: boolean) => void;
  /** Show the enable/disable toggle switch (search uses this; library doesn't) */
  showToggle?: boolean;
  /** Override active state for the trigger button display */
  isActive?: boolean;
}

/**
 * Shared year range picker with Popover, Slider, Input fields, and presets.
 *
 * Accepts value+onChange props so it can be used by both the search results
 * page (via context hooks) and the library page (via nuqs URL params).
 */
export function YearRangePicker({
  yearRange,
  onYearRangeChange,
  isEnabled = true,
  onToggleEnabled,
  showToggle = false,
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
      onYearRangeChange(normalizedRange);
      syncInputsToRange(normalizedRange);
    },
    [clampYear, onYearRangeChange, syncInputsToRange],
  );

  const commitFromInput = React.useCallback(
    (rawValue: string) => {
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

  const applyYearPreset = (preset: [number, number]) => {
    // Order matters. `updateFilter` reads a stale URL snapshot per call, and the
    // enable path re-derives yf/yt from the OLD range when none is passed — so an
    // enable issued AFTER the range clobbers the preset with the default range
    // (the "press twice to activate" bug). Enable first, then commit the range so
    // the preset is the last (winning) write.
    if (showToggle && !isEnabled && onToggleEnabled) {
      onToggleEnabled(true);
    }
    commitYearRange(preset);
  };

  // Whether to show the range controls (always when no toggle, or when enabled)
  const showRangeControls = !showToggle || isEnabled;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full h-10 justify-start text-left font-normal transition-all duration-200",
            isFilterActive
              ? "border-sidebar-primary/50"
              : "border-dashed border-muted-foreground/30",
          )}
        >
          <CalendarIcon className="mr-3 h-4 w-4 text-muted-foreground" />
          <span className="truncate">
            {isFilterActive
              ? `${yearRange[0]} → ${yearRange[1]}`
              : tf("filterByYearRange")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start">
        <div className="space-y-4">
          {/* Toggle (search-only) */}
          {showToggle && onToggleEnabled && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Switch
                  checked={isEnabled}
                  onCheckedChange={onToggleEnabled}
                  id="year-range-toggle"
                />
                <label
                  htmlFor="year-range-toggle"
                  className="text-sm font-medium cursor-pointer"
                >
                  {tf("filterByYearRange")}
                </label>
              </div>
              {isEnabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    commitYearRange([MIN_YEAR, currentYear]);
                    onToggleEnabled(false);
                  }}
                  className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  {tc("reset")}
                </Button>
              )}
            </div>
          )}

          {/* Range controls */}
          {showRangeControls && (
            <>
              <div className="text-center">
                <div className="text-sm font-medium text-muted-foreground">
                  {tf("yearRangeLabel")} {yearRange[0]} - {yearRange[1]}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    {tc("from")}
                  </label>
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
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    {tc("to")}
                  </label>
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
                </div>
              </div>

              <div className="space-y-3">
                <div className="px-1">
                  <Slider
                    value={yearRange}
                    onValueChange={(values) =>
                      commitYearRange([values[0], values[1]])
                    }
                    min={MIN_YEAR}
                    max={currentYear}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-2">
                    <span>{MIN_YEAR}</span>
                    <span>{currentYear}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Disabled state (toggle-only) */}
          {showToggle && !isEnabled && (
            <div className="text-center py-4 text-muted-foreground">
              <CalendarIcon className="h-6 w-6 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{tf("enableToggleToCustomize")}</p>
              <p className="text-xs mt-1">{tf("defaultAllYears")}</p>
            </div>
          )}

          {/* Quick Presets */}
          <div className="space-y-3">
            {showToggle && (
              <div className="text-xs font-medium text-muted-foreground">
                {tf("quickPresets")}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {getYearRangePresets().map((preset) => (
                <Button
                  key={preset.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyYearPreset(preset.range)}
                  className={
                    showToggle
                      ? "h-8 px-3 text-xs font-normal"
                      : undefined
                  }
                >
                  {tf(preset.key)}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
