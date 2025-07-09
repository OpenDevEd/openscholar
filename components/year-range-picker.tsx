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
import { updateCurrentSearchFilters } from "@/lib/search-actions";
import { useYearRangePickerStore } from "@/lib/store";

export function YearRangePicker() {
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

  const setIsYearRangeEnabled = async (enabled: boolean) => {
    updateFilter({ isYearRangeEnabled: enabled });
    await updateCurrentSearchFilters();
  };

  const currentYear = new Date().getFullYear();

  // Local input state so manual typing doesn't immediately get overridden by global state
  const [fromInput, setFromInput] = React.useState<string>(yearRange[0].toString());
  const [toInput, setToInput] = React.useState<string>(yearRange[1].toString());

  // Keep local inputs in sync when the global yearRange changes via slider / presets
  React.useEffect(() => {
    setFromInput(yearRange[0].toString());
    setToInput(yearRange[1].toString());
  }, [yearRange]);

  const handleYearRangeChange = (values: number[]) => {
    setYearRange([values[0], values[1]]);
    setFromInput(values[0].toString());
    setToInput(values[1].toString());
    // Don't close the popover when dragging the slider
    // The search will update automatically via the store
  };

  const applyYearPreset = async (preset: [number, number]) => {
    setYearRange(preset);
    setFromInput(preset[0].toString());
    setToInput(preset[1].toString());
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
            "w-full h-11 justify-start text-left font-normal border-2 transition-all duration-200",
            isFilterActive
              ? "border-purple-300 bg-purple-50 dark:bg-purple-950/30"
              : "border-dashed border-muted-foreground/30 hover:border-purple-300"
          )}
        >
          <CalendarIcon className="mr-3 h-4 w-4" />
          <span className="truncate">
            {isFilterActive ? `${yearRange[0]} → ${yearRange[1]}` : "Filter by year range"}
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
                Filter by year range
              </label>
            </div>
            {isYearRangeEnabled && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setYearRange([MIN_YEAR, currentYear]);
                  setFromInput(MIN_YEAR.toString());
                  setToInput(currentYear.toString());
                  setIsYearRangeEnabled(false);
                }}
                className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            )}
          </div>

          {isYearRangeEnabled && (
            <>
              {/* Header */}
              <div className="text-center">
                <div className="text-sm font-medium text-muted-foreground">
                  Year Range: {yearRange[0]} - {yearRange[1]}
                </div>
              </div>
              
              {/* Input Fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">From</label>
                  <Input
                    type="number"
                    min={MIN_YEAR}
                    max={currentYear}
                    value={fromInput}
                    onChange={(e) => {
                      setFromInput(e.target.value);
                    }}
                    onBlur={(e) => {
                      const value = parseInt(e.target.value);
                      if (isNaN(value) || value < MIN_YEAR) {
                        const newValue = MIN_YEAR;
                        setFromInput(newValue.toString());
                        setYearRange([newValue, yearRange[1]]);
                      } else if (value > yearRange[1]) {
                        setFromInput(yearRange[1].toString());
                        setYearRange([yearRange[1], yearRange[1]]);
                      } else if (value > currentYear) {
                        const newValue = currentYear;
                        setFromInput(newValue.toString());
                        setYearRange([newValue, yearRange[1]]);
                      } else {
                        setYearRange([value, yearRange[1]]);
                      }
                    }}
                    className="h-9 text-sm"
                    placeholder={MIN_YEAR.toString()}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">To</label>
                  <Input
                    type="number"
                    min={MIN_YEAR}
                    max={currentYear}
                    value={toInput}
                    onChange={(e) => {
                      setToInput(e.target.value);
                    }}
                    onBlur={(e) => {
                      const value = parseInt(e.target.value);
                      if (isNaN(value) || value > currentYear) {
                        const newValue = currentYear;
                        setToInput(newValue.toString());
                        setYearRange([yearRange[0], newValue]);
                      } else if (value < yearRange[0]) {
                        setToInput(yearRange[0].toString());
                        setYearRange([yearRange[0], yearRange[0]]);
                      } else if (value < MIN_YEAR) {
                        const newValue = MIN_YEAR;
                        setToInput(newValue.toString());
                        setYearRange([yearRange[0], newValue]);
                      } else {
                        setYearRange([yearRange[0], value]);
                      }
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
              <p className="text-sm">Enable the toggle above to customize the year range</p>
              <p className="text-xs mt-1">
                By default, all years are included in your search
              </p>
            </div>
          )}

          {/* Quick Presets - Always visible */}
          <div className="space-y-3">
            <div className="text-xs font-medium text-muted-foreground">Quick presets</div>
            <div className="grid grid-cols-2 gap-2">
              {getYearRangePresets().map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyYearPreset(preset.range)}
                  className="h-8 px-3 text-xs font-normal"
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
} 