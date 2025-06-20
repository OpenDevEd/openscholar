"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { X, CalendarIcon, Filter, SortAsc, Settings, Sparkles, Zap, Clock, Target, Star, Globe, Quote, Network } from "lucide-react";
import { format } from "date-fns";
import { cn, fields, isDateFilterActive, isRatingFilterActive, isCountryFilterActive, isCountryFocusActive, isCitesFilterActive, isRelatedToFilterActive, DEFAULT_FILTERS } from "@/lib/utils";
import type { SearchField } from "@/lib/types";
import { sortOptions } from "@/lib/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { updateCurrentSearchFilters } from "@/lib/search-actions";
import { YearRangePicker } from "./year-range-picker";
import { RatingRangePicker } from "./rating-range-picker";
import { CountryRegionPicker } from "./country-region-picker";
import { CountryFocusPicker } from "./country-focus-picker";
import { CitesFilter } from "./cites-filter";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { DateRange } from "react-day-picker";
import { RelatedToFilter } from "./related-to-filter";
import { WorkIdFilter } from "./work-id-filter";

interface SearchSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  isMobile?: boolean;
  mode?: 'sidebar' | 'sheet' | 'page';
}

export function SearchSidebar({ isOpen, onClose, isMobile = false, mode = 'sidebar' }: SearchSidebarProps) {
  const {
    currentSearchField,
    dateRange,
    sortBy,
    filterType,
    selectedRegions,
    selectedCountryFocus,
    ratingRange,
    onlyRatedPapers,
    citesItemId,
    relatedToItemId,
    yearRange,
    isYearRangeEnabled,
  } = useCurrentSearchFormState();
  
  const updateFilter = useUpdateSearchFilter();
  
  // Control date picker popover state to prevent auto-close on filter updates
  const [isDatePickerOpen, setIsDatePickerOpen] = React.useState(false);

  // Computed filter active states using utility functions
  const isDateActive = isDateFilterActive(dateRange, yearRange, filterType, isYearRangeEnabled);
  const isRatingActive = isRatingFilterActive(ratingRange, onlyRatedPapers);
  const isCountryActive = isCountryFilterActive(selectedRegions);
  const isCountryFocusFilterActive = isCountryFocusActive(selectedCountryFocus);
  const isCitesActive = isCitesFilterActive(citesItemId);
  const isRelatedToActive = isRelatedToFilterActive(relatedToItemId);

  // Helper functions that update store and trigger search update
  const handleSearchFieldChange = async (field: SearchField) => {
    updateFilter({ currentSearchField: field });
    await updateCurrentSearchFilters();
  };

  const handleSortChange = async (sort: string) => {
    updateFilter({ sortBy: sort });
    await updateCurrentSearchFilters();
  };

  const handleFilterTypeChange = async (type: "date" | "year") => {
    updateFilter({ filterType: type });
    await updateCurrentSearchFilters();
  };

  const handleDateRangeChange = async (range: DateRange | undefined) => {
    updateFilter({ dateRange: range });
    // Don't close the date picker when selecting dates
    // Only update search filters, let user close manually
    await updateCurrentSearchFilters();
  };

  const handleClearDateRange = async () => {
    updateFilter({ dateRange: undefined });
    await updateCurrentSearchFilters();
  };

  const handleClearYearRange = async () => {
    const defaultRange = DEFAULT_FILTERS.yearRange();
    updateFilter({ 
      yearRange: defaultRange,
      isYearRangeEnabled: DEFAULT_FILTERS.isYearRangeEnabled 
    });
    await updateCurrentSearchFilters();
  };

  const handleClearRatingFilter = () => {
    updateFilter({ 
      ratingRange: DEFAULT_FILTERS.ratingRange, 
      onlyRatedPapers: DEFAULT_FILTERS.onlyRatedPapers 
    });
    // No need to fetch new results - rating filter works client-side
  };

  const handleClearCitesFilter = async () => {
    updateFilter({ citesItemId: DEFAULT_FILTERS.citesItemId });
    await updateCurrentSearchFilters();
  };

  const handleClearRelatedToFilter = async () => {
    updateFilter({ relatedToItemId: DEFAULT_FILTERS.relatedToItemId });
    await updateCurrentSearchFilters();
  };

  const handleClearAllFilters = async () => {
    const defaultYearRange = DEFAULT_FILTERS.yearRange();
    updateFilter({
      currentSearchField: DEFAULT_FILTERS.field,
      sortBy: DEFAULT_FILTERS.sortBy,
      dateRange: DEFAULT_FILTERS.dateRange,
      yearRange: defaultYearRange,
      isYearRangeEnabled: DEFAULT_FILTERS.isYearRangeEnabled,
      ratingRange: DEFAULT_FILTERS.ratingRange,
      onlyRatedPapers: DEFAULT_FILTERS.onlyRatedPapers,
      selectedRegions: DEFAULT_FILTERS.selectedRegions,
      selectedCountryFocus: DEFAULT_FILTERS.selectedCountryFocus,
      citesItemId: DEFAULT_FILTERS.citesItemId,
      relatedToItemId: DEFAULT_FILTERS.relatedToItemId
    });
    await updateCurrentSearchFilters(); // Only for the server-side filters
  };

  const getActiveFiltersCount = () => {
    let count = 0;
    if (isDateActive) count++;
    if (isRatingActive) count++;
    if (isCountryActive) count++;
    if (isCountryFocusFilterActive) count++;
    if (isCitesActive) count++;
    if (isRelatedToActive) count++;
    if (sortBy !== DEFAULT_FILTERS.sortBy) count++;
    return count;
  };

  const activeFiltersCount = getActiveFiltersCount();

  const fieldIcons = {
    "title_and_abstract": Target,
    "title": Zap,
    "abstract": Filter,
    "fulltext": Sparkles,
    "display_name": Settings
  };

  const SidebarContent = () => (
    <div className="space-y-6">
      {/* Simple Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Filters</h2>
        {activeFiltersCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAllFilters}
            className="text-xs h-7 px-3 text-muted-foreground hover:text-foreground"
          >
            Clear all ({activeFiltersCount})
          </Button>
        )}
      </div>

      {/* Date Filter - Floating Panel */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Clock className="h-4 w-4 text-purple-500" />
            Publication timeframe
          </div>
          {isDateActive && (
            <Badge variant="outline" className="text-xs border-purple-500 text-purple-600 dark:text-purple-400">
              Active
            </Badge>
          )}
        </div>

        <div className={cn(
          "rounded-2xl border-2 p-4 transition-all duration-300",
          isDateActive 
            ? "border-purple-500 bg-purple-50 dark:bg-purple-950/50 shadow-lg" 
            : "border-border bg-background"
        )}>
          <div className="space-y-4">
            {/* Filter Type Toggle */}
            <div className="flex rounded-lg bg-muted p-1">
              <button
                onClick={() => handleFilterTypeChange("year")}
                className={cn(
                  "flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all duration-200",
                  filterType === "year"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Year range
              </button>
              <button
                onClick={() => handleFilterTypeChange("date")}
                className={cn(
                  "flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all duration-200",
                  filterType === "date"
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Specific dates
              </button>
            </div>

            {/* Filter Content */}
            {filterType === "date" ? (
              <div className="space-y-3">
                <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full h-11 justify-start text-left font-normal border-2",
                        isDateActive && dateRange?.from
                          ? "border-purple-300 bg-purple-50 dark:bg-purple-950/30"
                          : "border-dashed border-muted-foreground/30"
                      )}
                    >
                      <CalendarIcon className="mr-3 h-4 w-4" />
                      {isDateActive && dateRange?.from ? (
                        dateRange.to ? (
                          <span className="truncate">
                            {format(dateRange.from, "MMM dd, yyyy")} → {format(dateRange.to, "MMM dd, yyyy")}
                          </span>
                        ) : (
                          <span className="truncate">
                            From {format(dateRange.from, "MMM dd, yyyy")}
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">Choose date range</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      initialFocus
                      mode="range"
                      defaultMonth={dateRange?.from}
                      selected={dateRange}
                      onSelect={(range) => {
                        handleDateRangeChange(range);
                      }}
                      numberOfMonths={2}
                    />
                  </PopoverContent>
                </Popover>
                
                {isDateActive && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearDateRange}
                    className="w-full h-9 text-sm text-purple-600 hover:text-purple-700 hover:bg-purple-100 dark:text-purple-400 dark:hover:bg-purple-950/50"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Clear date filter
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <YearRangePicker />
                {isDateActive && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearYearRange}
                    className="w-full h-9 text-sm text-purple-600 hover:text-purple-700 hover:bg-purple-100 dark:text-purple-400 dark:hover:bg-purple-950/50"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Clear year filter
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rating Filter - Floating Panel */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Star className="h-4 w-4 text-orange-500" />
            Rating filter
          </div>
          {isRatingActive && (
            <Badge variant="outline" className="text-xs border-orange-500 text-orange-600 dark:text-orange-400">
              Active
            </Badge>
          )}
        </div>

        <div className={cn(
          "rounded-2xl border-2 p-4 transition-all duration-300",
          isRatingActive 
            ? "border-orange-500 bg-orange-50 dark:bg-orange-950/50 shadow-lg" 
            : "border-border bg-background"
        )}>
          <div className="space-y-4">
            <RatingRangePicker />
            {isRatingActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearRatingFilter}
                className="w-full h-9 text-sm text-orange-600 hover:text-orange-700 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-950/50"
              >
                <X className="h-4 w-4 mr-2" />
                Clear rating filter
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Institution Location Filter - Floating Panel */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Globe className="h-4 w-4 text-emerald-500" />
            Institution location
          </div>
          {isCountryActive && (
            <Badge variant="outline" className="text-xs border-emerald-500 text-emerald-600 dark:text-emerald-400">
              Active
            </Badge>
          )}
        </div>

        <div className={cn(
          "rounded-2xl border-2 p-4 transition-all duration-300",
          isCountryActive 
            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 shadow-lg" 
            : "border-border bg-background"
        )}>
          <CountryRegionPicker />
        </div>
      </div>

      {/* Country focus Filter - Floating Panel */}
      <CountryFocusPicker />

      {/* Search Field - Chip Style */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Target className="h-4 w-4 text-blue-500" />
          Search scope
        </div>
        <div className="grid grid-cols-1 gap-2">
          {fields.map((field) => {
            const Icon = fieldIcons[field.value as keyof typeof fieldIcons] || Filter;
            const isSelected = currentSearchField === field.value;
            return (
              <button
                key={field.value}
                onClick={() => handleSearchFieldChange(field.value as SearchField)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border-2 transition-all duration-200 text-left",
                  isSelected
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/50 shadow-md"
                    : "border-border hover:border-blue-300 hover:bg-blue-50/50 dark:hover:bg-blue-950/20"
                )}
              >
                <div className={cn(
                  "p-1.5 rounded-lg",
                  isSelected 
                    ? "bg-blue-500 text-white" 
                    : "bg-muted text-muted-foreground"
                )}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1">
                  <div className={cn(
                    "font-medium text-sm",
                    isSelected ? "text-blue-700 dark:text-blue-300" : "text-foreground"
                  )}>
                    {field.label}
                  </div>
                </div>
                {isSelected && (
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sort Options - Visual Cards */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <SortAsc className="h-4 w-4 text-green-500" />
          Sort results by
        </div>
        <div className="grid grid-cols-1 gap-2">
          {sortOptions.map((option) => {
            const isSelected = sortBy === option.value;
            return (
              <button
                key={option.value}
                onClick={() => handleSortChange(option.value)}
                className={cn(
                  "flex items-center justify-between p-3 rounded-xl border-2 transition-all duration-200 text-left",
                  isSelected
                    ? "border-green-500 bg-green-50 dark:bg-green-950/50 shadow-md"
                    : "border-border hover:border-green-300 hover:bg-green-50/50 dark:hover:bg-green-950/20"
                )}
              >
                <div className={cn(
                  "font-medium text-sm",
                  isSelected ? "text-green-700 dark:text-green-300" : "text-foreground"
                )}>
                  {option.label}
                </div>
                {isSelected && (
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Cites Filter - Floating Panel */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Quote className="h-4 w-4 text-orange-500" />
            Citation filter
          </div>
          {isCitesActive && (
            <Badge variant="outline" className="text-xs border-orange-500 text-orange-600 dark:text-orange-400">
              Active
            </Badge>
          )}
        </div>

        <div className={cn(
          "rounded-2xl border-2 p-4 transition-all duration-300",
          isCitesActive 
            ? "border-orange-500 bg-orange-50 dark:bg-orange-950/50 shadow-lg" 
            : "border-border bg-background"
        )}>
          <div className="space-y-4">
            <CitesFilter />
            {isCitesActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearCitesFilter}
                className="w-full h-9 text-sm text-orange-600 hover:text-orange-700 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-950/50"
              >
                <X className="h-4 w-4 mr-2" />
                Clear citation filter
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Related To Filter - Floating Panel */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Network className="h-4 w-4 text-blue-500" />
            Related works filter
          </div>
          {isRelatedToActive && (
            <Badge variant="outline" className="text-xs border-blue-500 text-blue-600 dark:text-blue-400">
              Active
            </Badge>
          )}
        </div>

        <div className={cn(
          "rounded-2xl border-2 p-4 transition-all duration-300",
          isRelatedToActive 
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/50 shadow-lg" 
            : "border-border bg-background"
        )}>
          <div className="space-y-4">
            <RelatedToFilter />
            {isRelatedToActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearRelatedToFilter}
                className="w-full h-9 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-950/50"
              >
                <X className="h-4 w-4 mr-2" />
                Clear related works filter
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (mode === 'sheet') {
    return (
      <Sheet open={isOpen} onOpenChange={onClose}>
        <SheetContent 
          side="right" 
          className="w-80 p-0 bg-background border-r overflow-hidden flex flex-col"
        >
          <SheetHeader className="px-6 py-4 border-b bg-background">
            <SheetTitle>Search Filters</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <SidebarContent />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (mode === 'page') {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <SidebarContent />
      </div>
    );
  }

  return (
    <div className="w-80 p-6 bg-gradient-to-b from-background via-background to-muted/20 rounded-2xl border border-border/50 shadow-xl backdrop-blur-sm">
      <SidebarContent />
    </div>
  );
} 