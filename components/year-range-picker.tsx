"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_YEAR, getYearRangePresets } from "@/lib/constants";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { isDateFilterActive } from "@/lib/utils";
import { useYearRangePickerStore } from "@/lib/store";
import { useTranslations } from "next-intl";

export function YearRangePicker() {
  const tf = useTranslations("searchFilters");
  const tc = useTranslations("common");
  const {
    yearRange,
    dateRange,
    filterType,
    isYearRangeEnabled,
  } = useCurrentSearchFormState();
  
  const isFilterActive = isDateFilterActive(dateRange, yearRange, filterType, isYearRangeEnabled);
  
  const updateFilter = useUpdateSearchFilter();
  
  // Control popover state to prevent auto-close on filter updates
  const { isOpen, setIsOpen } = useYearRangePickerStore();

  const setYearRange = (range: [number, number]) => {
    updateFilter({ yearRange: range });
  };

  const setIsYearRangeEnabled = (enabled: boolean) => {
    updateFilter({ isYearRangeEnabled: enabled });
  };

  const currentYear = new Date().getFullYear();

  // Local input state so manual typing doesn't immediately get overridden by global state
  const [fromInput, setFromInput] = React.useState<string>(yearRange[0].toString());
  const [toInput, setToInput] = React.useState<string>(yearRange[1].toString());

  const syncInputsToRange = React.useCallback((range: [number, number]) => {
    setFromInput(range[0].toString());
    setToInput(range[1].toString());
  }, []);

  // Keep local inputs in sync only when year values change (not array identity).
  React.useEffect(() => {
    syncInputsToRange(yearRange);
  }, [syncInputsToRange, yearRange[0], yearRange[1]]);

  const clampYear = React.useCallback((value: number) => {
    return Math.min(currentYear, Math.max(MIN_YEAR, value));
  }, [currentYear]);

  const commitYearRange = React.useCallback((nextRange: [number, number]) => {
    const clampedFrom = clampYear(nextRange[0]);
    const clampedTo = clampYear(nextRange[1]);

    const normalizedRange: [number, number] =
      clampedFrom <= clampedTo
        ? [clampedFrom, clampedTo]
        : [clampedTo, clampedTo];

    setYearRange(normalizedRange);
    syncInputsToRange(normalizedRange);
  }, [clampYear, setYearRange, syncInputsToRange]);

  const commitFromInput = React.useCallback((rawValue: string) => {
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
  }, [clampYear, commitYearRange, yearRange]);

  const commitToInput = React.useCallback((rawValue: string) => {
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
  }, [clampYear, commitYearRange, currentYear, yearRange]);

  const handleYearRangeChange = (values: number[]) => {
    commitYearRange([values[0], values[1]]);
    // Don't close the popover when dragging the slider
    // The search will update automatically via the store
  };

  const applyYearPreset = (preset: [number, number]) => {
    commitYearRange(preset);
    // Automatically enable the toggle when a preset is selected
    if (!isYearRangeEnabled) {
      setIsYearRangeEnabled(true);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full h-10 justify-start text-left font-normal transition-all duration-200",
            isFilterActive
              ? "border-sidebar-primary/50"
              : "border-dashed border-muted-foreground/30"
          )}
        >
          <CalendarIcon className="mr-3 h-4 w-4" />
          <span className="truncate">
            {isFilterActive ? `${yearRange[0]} → ${yearRange[1]}` : tf("filterByYearRange")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start">
        <div className="space-y-4">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Switch
                checked={isYearRangeEnabled}
                onCheckedChange={setIsYearRangeEnabled}
                id="year-range-toggle"
              />
              <label
                htmlFor="year-range-toggle"
                className="text-sm font-medium cursor-pointer"
              >
                {tf("filterByYearRange")}
              </label>
            </div>
            {isYearRangeEnabled && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  commitYearRange([MIN_YEAR, currentYear]);
                  setIsYearRangeEnabled(false);
                }}
                className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                {tc("reset")}
              </Button>
            )}
          </div>

          {isYearRangeEnabled && (
            <>
              {/* Header */}
              <div className="text-center">
                <div className="text-sm font-medium text-muted-foreground">
                  {tf("yearRangeLabel")} {yearRange[0]} - {yearRange[1]}
                </div>
              </div>
              
              {/* Input Fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">{tc("from")}</label>
                  <Input
                    type="number"
                    min={MIN_YEAR}
                    max={currentYear}
                    value={fromInput}
                    onChange={(e) => {
                      setFromInput(e.target.value);
                    }}
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
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">{tc("to")}</label>
                  <Input
                    type="number"
                    min={MIN_YEAR}
                    max={currentYear}
                    value={toInput}
                    onChange={(e) => {
                      setToInput(e.target.value);
                    }}
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
              
              {/* Slider */}
              <div className="space-y-3">
                <div className="px-1">
                  <Slider
                    value={yearRange}
                    onValueChange={handleYearRangeChange}
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

          {!isYearRangeEnabled && (
            <div className="text-center py-4 text-muted-foreground">
              <CalendarIcon className="h-6 w-6 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{tf("enableToggleToCustomize")}</p>
              <p className="text-xs mt-1">
                {tf("defaultAllYears")}
              </p>
            </div>
          )}

          {/* Quick Presets - Always visible */}
          <div className="space-y-3">
            <div className="text-xs font-medium text-muted-foreground">{tf("quickPresets")}</div>
            <div className="grid grid-cols-2 gap-2">
              {getYearRangePresets().map((preset) => (
                <Button
                  key={preset.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyYearPreset(preset.range)}
                  className="h-8 px-3 text-xs font-normal"
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
