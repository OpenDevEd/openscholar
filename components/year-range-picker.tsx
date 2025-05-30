import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_YEAR, getYearRangePresets } from "@/lib/constants";
import { Slider } from "@/components/ui/slider";
import { useSearchFormStore } from "@/lib/store";

export function YearRangePicker() {
  const {
    yearRange,
    isFilterActive,
    yearFromInput,
    yearToInput,
    setYearRange,
    setIsFilterActive,
    setYearFromInput,
    setYearToInput,
    clearYearRange
  } = useSearchFormStore();

  const currentYear = new Date().getFullYear();

  const handleYearRangeChange = (values: number[]) => {
    setYearRange([values[0], values[1]]);
    setYearFromInput(values[0].toString());
    setYearToInput(values[1].toString());
    setIsFilterActive(true);
  };

  const applyYearPreset = (preset: [number, number]) => {
    setYearRange(preset);
    setYearFromInput(preset[0].toString());
    setYearToInput(preset[1].toString());
    setIsFilterActive(true);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "flex-1 sm:w-[280px] justify-start text-left font-normal",
            !isFilterActive && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          <span>{isFilterActive ? `${yearRange[0]} - ${yearRange[1]}` : "Pick a year range"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start">
        <div className="space-y-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Year Range: {yearRange[0]} - {yearRange[1]}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearYearRange}
              className="h-6 px-2 text-xs"
            >
              Reset
            </Button>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">From</label>
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
                    setIsFilterActive(true);
                  }
                }}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">To</label>
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
                    setIsFilterActive(true);
                  }
                }}
                className="h-8 text-sm"
              />
            </div>
          </div>
          
          <div className="px-2">
            <Slider
              value={yearRange}
              onValueChange={handleYearRangeChange}
              min={MIN_YEAR}
              max={currentYear}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>{MIN_YEAR}</span>
              <span>{currentYear}</span>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Quick presets:</div>
            <div className="grid grid-cols-2 gap-1">
              {getYearRangePresets().map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => applyYearPreset(preset.range)}
                  className="h-7 px-2 text-xs"
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