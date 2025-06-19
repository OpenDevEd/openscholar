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
import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { isDateFilterActive, DEFAULT_FILTERS } from "@/lib/utils";

export function YearRangePicker() {
  const {
    yearRange,
    dateRange,
    yearFromInput,
    yearToInput,
    filterType,
  } = useCurrentSearchFormState();
  
  const isFilterActive = isDateFilterActive(dateRange, yearRange, filterType);
  
  const updateFilter = useUpdateSearchFilter();

  const setYearRange = (range: [number, number]) => {
    updateFilter({ yearRange: range });
  };



  const setYearFromInput = (value: string) => {
    updateFilter({ yearFromInput: value });
  };

  const setYearToInput = (value: string) => {
    updateFilter({ yearToInput: value });
  };

  const currentYear = new Date().getFullYear();
  const [localYearRange, setLocalYearRange] = React.useState<[number, number]>(yearRange);
  const [localFromInput, setLocalFromInput] = React.useState(yearFromInput);
  const [localToInput, setLocalToInput] = React.useState(yearToInput);

  const handleYearRangeChange = (values: number[]) => {
    setYearRange([values[0], values[1]]);
    setYearFromInput(values[0].toString());
    setYearToInput(values[1].toString());
  };

  const applyYearPreset = (preset: [number, number]) => {
    setYearRange(preset);
    setYearFromInput(preset[0].toString());
    setYearToInput(preset[1].toString());
  };

  return (
    <Popover>
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
            {isFilterActive ? `${yearRange[0]} → ${yearRange[1]}` : "Choose year range"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">
              Year Range: {yearRange[0]} - {yearRange[1]}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setYearRange([MIN_YEAR, currentYear]);
                setYearFromInput(MIN_YEAR.toString());
                setYearToInput(currentYear.toString());
              }}
              className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3 mr-1" />
              Reset
            </Button>
          </div>
          
          {/* Input Fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input
                type="number"
                min={MIN_YEAR}
                max={currentYear}
                value={yearFromInput}
                onChange={(e) => {
                  setYearFromInput(e.target.value);
                }}
                onBlur={(e) => {
                  const value = parseInt(e.target.value);
                  if (isNaN(value) || value < MIN_YEAR) {
                    const newValue = MIN_YEAR;
                    setYearFromInput(newValue.toString());
                    setYearRange([newValue, yearRange[1]]);
                  } else if (value > yearRange[1]) {
                    setYearFromInput(yearRange[1].toString());
                    setYearRange([yearRange[1], yearRange[1]]);
                  } else if (value > currentYear) {
                    const newValue = currentYear;
                    setYearFromInput(newValue.toString());
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
                value={yearToInput}
                onChange={(e) => {
                  setYearToInput(e.target.value);
                }}
                onBlur={(e) => {
                  const value = parseInt(e.target.value);
                  if (isNaN(value) || value > currentYear) {
                    const newValue = currentYear;
                    setYearToInput(newValue.toString());
                    setYearRange([yearRange[0], newValue]);
                  } else if (value < yearRange[0]) {
                    setYearToInput(yearRange[0].toString());
                    setYearRange([yearRange[0], yearRange[0]]);
                  } else if (value < MIN_YEAR) {
                    const newValue = MIN_YEAR;
                    setYearToInput(newValue.toString());
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
          
          {/* Quick Presets */}
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