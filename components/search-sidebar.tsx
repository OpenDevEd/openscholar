"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { X, CalendarIcon, Filter, SortAsc, Settings, Sparkles, Zap, Clock, Target, Star, Globe, Quote, Network, FileText } from "lucide-react";
import { format } from "date-fns";
import { cn, fields, isDateFilterActive, isRatingFilterActive, isCountryFilterActive, isCountryFocusActive, isCitesFilterActive, isCitedByFilterActive, isRelatedToFilterActive, isReviewFilterActive, DEFAULT_FILTERS } from "@/lib/utils";
import type { SearchField } from "@/lib/types";
import { sortOptions } from "@/lib/constants";
import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { updateCurrentSearchFilters } from "@/lib/search-actions";
import { YearRangePicker } from "./year-range-picker";
import { RatingRangePicker } from "./rating-range-picker";
import { CountryRegionPicker } from "./country-region-picker";
import { CountryFocusPicker } from "./country-focus-picker";
import { CitesFilter } from "./cites-filter";
import { CitedByFilter } from "./cited-by-filter";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { DateRange } from "react-day-picker";
import { RelatedToFilter } from "./related-to-filter";
import { ReviewFilter } from "./review-filter";

interface SearchSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  isMobile?: boolean;
  mode?: 'sidebar' | 'sheet' | 'page';
}

// Filter wrapper component for consistent styling
interface FilterWrapperProps {
  title: string;
  icon: React.ElementType;
  colorScheme: 'purple' | 'orange' | 'emerald' | 'blue' | 'green' | 'pink';
  isActive: boolean;
  children: React.ReactNode;
}

function FilterWrapper({ title, icon: Icon, colorScheme, isActive, children }: FilterWrapperProps) {
  const colorClasses = {
    purple: {
      icon: "text-purple-500",
      badge: "border-purple-500 text-purple-600 dark:text-purple-400",
      border: "border-purple-500 bg-purple-50 dark:bg-purple-950/50 shadow-lg"
    },
    orange: {
      icon: "text-orange-500",
      badge: "border-orange-500 text-orange-600 dark:text-orange-400",
      border: "border-orange-500 bg-orange-50 dark:bg-orange-950/50 shadow-lg"
    },
    emerald: {
      icon: "text-emerald-500",
      badge: "border-emerald-500 text-emerald-600 dark:text-emerald-400",
      border: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 shadow-lg"
    },
    blue: {
      icon: "text-blue-500",
      badge: "border-blue-500 text-blue-600 dark:text-blue-400",
      border: "border-blue-500 bg-blue-50 dark:bg-blue-950/50 shadow-lg"
    },
    green: {
      icon: "text-green-500",
      badge: "border-green-500 text-green-600 dark:text-green-400",
      border: "border-green-500 bg-green-50 dark:bg-green-950/50 shadow-lg"
    },
    pink: {
      icon: "text-pink-500",
      badge: "border-pink-500 text-pink-600 dark:text-pink-400",
      border: "border-pink-500 bg-pink-50 dark:bg-pink-950/50 shadow-lg"
    }
  };

  const colors = colorClasses[colorScheme];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Icon className={cn("h-4 w-4", colors.icon)} />
          {title}
        </div>
        {isActive && (
          <Badge variant="outline" className={cn("text-xs", colors.badge)}>
            Active
          </Badge>
        )}
      </div>

      <div className={cn(
        "rounded-2xl border-2 p-4 transition-all duration-300",
        isActive ? colors.border : "border-border bg-background"
      )}>
        {children}
      </div>
    </div>
  );
}

// Date Filter Component
function DateFilterPanel() {
  const { dateRange, filterType, isYearRangeEnabled, yearRange } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const [isDatePickerOpen, setIsDatePickerOpen] = React.useState(false);
  const isDateActive = isDateFilterActive(dateRange, yearRange, filterType, isYearRangeEnabled);

  const handleFilterTypeChange = async (type: "date" | "year") => {
    updateFilter({ filterType: type });
    await updateCurrentSearchFilters();
  };

  const handleDateRangeChange = async (range: DateRange | undefined) => {
    updateFilter({ dateRange: range });
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

  return (
    <FilterWrapper
      title="Publication timeframe"
      icon={Clock}
      colorScheme="purple"
      isActive={isDateActive}
    >
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
    </FilterWrapper>
  );
}

// Rating Filter Component
function RatingFilterPanel() {
  const { ratingRange, onlyRatedPapers } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isRatingActive = isRatingFilterActive(ratingRange, onlyRatedPapers);

  const handleClearRatingFilter = () => {
    updateFilter({ 
      ratingRange: DEFAULT_FILTERS.ratingRange, 
      onlyRatedPapers: DEFAULT_FILTERS.onlyRatedPapers 
    });
  };

  return (
    <FilterWrapper
      title="Rating filter"
      icon={Star}
      colorScheme="orange"
      isActive={isRatingActive}
    >
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
    </FilterWrapper>
  );
}

// Institution Location Filter Component
function InstitutionLocationFilterPanel() {
  const { selectedRegions } = useCurrentSearchFormState();
  const isCountryActive = isCountryFilterActive(selectedRegions);

  return (
    <FilterWrapper
      title="Institution location"
      icon={Globe}
      colorScheme="emerald"
      isActive={isCountryActive}
    >
      <CountryRegionPicker />
    </FilterWrapper>
  );
}

// Search Field Component
function SearchFieldPanel() {
  const { currentSearchField } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const handleSearchFieldChange = async (field: SearchField) => {
    updateFilter({ currentSearchField: field });
    await updateCurrentSearchFilters();
  };

  const fieldIcons = {
    "title_and_abstract": Target,
    "title": Zap,
    "abstract": Filter,
    "fulltext": Sparkles,
    "display_name": Settings
  };

  return (
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
  );
}

// Sort Options Component
function SortOptionsPanel() {
  const { sortBy } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const handleSortChange = async (sort: string) => {
    updateFilter({ sortBy: sort });
    await updateCurrentSearchFilters();
  };

  return (
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
  );
}

// Cites Filter Component
function CitesFilterPanel() {
  const { citesItemId } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isCitesActive = isCitesFilterActive(citesItemId);

  const handleClearCitesFilter = async () => {
    updateFilter({ citesItemId: DEFAULT_FILTERS.citesItemId });
    await updateCurrentSearchFilters();
  };

  return (
    <FilterWrapper
      title="Citation filter"
      icon={Quote}
      colorScheme="orange"
      isActive={isCitesActive}
    >
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
    </FilterWrapper>
  );
}

// Cited By Filter Component
function CitedByFilterPanel() {
  const { citedByItemId } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isCitedByActive = isCitedByFilterActive(citedByItemId);

  const handleClearCitedByFilter = async () => {
    updateFilter({ citedByItemId: DEFAULT_FILTERS.citedByItemId });
    await updateCurrentSearchFilters();
  };

  return (
    <FilterWrapper
      title="Cited by filter"
      icon={Quote}
      colorScheme="green"
      isActive={isCitedByActive}
    >
      <div className="space-y-4">
        <CitedByFilter />
        {isCitedByActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearCitedByFilter}
            className="w-full h-9 text-sm text-green-600 hover:text-green-700 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-950/50"
          >
            <X className="h-4 w-4 mr-2" />
            Clear cited by filter
          </Button>
        )}
      </div>
    </FilterWrapper>
  );
}

// Related To Filter Component
function RelatedToFilterPanel() {
  const { relatedToItemId } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isRelatedToActive = isRelatedToFilterActive(relatedToItemId);

  const handleClearRelatedToFilter = async () => {
    updateFilter({ relatedToItemId: DEFAULT_FILTERS.relatedToItemId });
    await updateCurrentSearchFilters();
  };

  return (
    <FilterWrapper
      title="Related works filter"
      icon={Network}
      colorScheme="blue"
      isActive={isRelatedToActive}
    >
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
    </FilterWrapper>
  );
}

// Review Filter Component
function ReviewFilterPanel() {
  const { reviewFilter } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isReviewActive = isReviewFilterActive(reviewFilter);

  const handleClearReviewFilter = async () => {
    updateFilter({ reviewFilter: DEFAULT_FILTERS.reviewFilter });
    await updateCurrentSearchFilters();
  };

  return (
    <FilterWrapper
      title="Review filter"
      icon={FileText}
      colorScheme="pink"
      isActive={isReviewActive}
    >
      <div className="space-y-4">
        <ReviewFilter />
        {isReviewActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClearReviewFilter}
            className="w-full h-9 text-sm text-pink-600 hover:text-pink-700 hover:bg-pink-100 dark:text-pink-400 dark:hover:bg-pink-950/50"
          >
            <X className="h-4 w-4 mr-2" />
            Clear review filter
          </Button>
        )}
      </div>
    </FilterWrapper>
  );
}

export function SearchSidebar({ isOpen, onClose, isMobile = false, mode = 'sidebar' }: SearchSidebarProps) {
  const {
    currentSearchField,
    sortBy,
    selectedRegions,
    selectedCountryFocus,
    ratingRange,
    onlyRatedPapers,
    citesItemId,
    citedByItemId,
    relatedToItemId,
    yearRange,
    isYearRangeEnabled,
    reviewFilter,
    dateRange,
    filterType,
  } = useCurrentSearchFormState();
  
  const updateFilter = useUpdateSearchFilter();

  // Computed filter active states using utility functions
  const isDateActive = isDateFilterActive(dateRange, yearRange, filterType, isYearRangeEnabled);
  const isRatingActive = isRatingFilterActive(ratingRange, onlyRatedPapers);
  const isCountryActive = isCountryFilterActive(selectedRegions);
  const isCountryFocusFilterActive = isCountryFocusActive(selectedCountryFocus);
  const isCitesActive = isCitesFilterActive(citesItemId);
  const isCitedByActive = isCitedByFilterActive(citedByItemId);
  const isRelatedToActive = isRelatedToFilterActive(relatedToItemId);
  const isReviewActive = isReviewFilterActive(reviewFilter);

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
      citedByItemId: DEFAULT_FILTERS.citedByItemId,
      relatedToItemId: DEFAULT_FILTERS.relatedToItemId,
      reviewFilter: DEFAULT_FILTERS.reviewFilter,
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
    if (isCitedByActive) count++;
    if (isRelatedToActive) count++;
    if (isReviewActive) count++;
    if (currentSearchField !== DEFAULT_FILTERS.field) count++;
    if (sortBy !== DEFAULT_FILTERS.sortBy) count++;
    return count;
  };

  const activeFiltersCount = getActiveFiltersCount();

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

      {/* ID Filters - Show at top when active */}
      {isCitesActive && <CitesFilterPanel />}
      {isCitedByActive && <CitedByFilterPanel />}
      {isRelatedToActive && <RelatedToFilterPanel />}

      {/* Date Filter - Floating Panel */}
      <DateFilterPanel />

      {/* Rating Filter - Floating Panel */}
      <RatingFilterPanel />

      {/* Institution Location Filter - Floating Panel */}
      <InstitutionLocationFilterPanel />

      {/* Country focus Filter - Floating Panel */}
      <CountryFocusPicker />

      {/* Search Field - Chip Style */}
      <SearchFieldPanel />

      {/* Sort Options - Visual Cards */}
      <SortOptionsPanel />

      {/* Review Filter - Floating Panel */}
      <ReviewFilterPanel />
      
      {/* Cites Filter - Floating Panel (when not active) */}
      {!isCitesActive && <CitesFilterPanel />}

      {/* Cited By Filter - Floating Panel (when not active) */}
      {!isCitedByActive && <CitedByFilterPanel />}

      {/* Related To Filter - Floating Panel (when not active) */}
      {!isRelatedToActive && <RelatedToFilterPanel />}

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