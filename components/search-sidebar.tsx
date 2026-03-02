"use client";

import React, { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  X,
  CalendarIcon,
  Filter,
  SortAsc,
  Clock,
  Target,
  Star,
  Globe,
  Quote,
  Network,
  FileText,
  Focus,
} from "lucide-react";
import { format } from "date-fns";
import {
  cn,
  isDateFilterActive,
  isRatingFilterActive,
  isCountryFilterActive,
  isCitesFilterActive,
  isCitedByFilterActive,
  isRelatedToFilterActive,
  isReviewFilterActive,
  DEFAULT_FILTERS,
} from "@/lib/utils";
import { countActiveFilters } from "@/lib/filters";
import type { SearchField } from "@/lib/types";
import { SEARCH_FIELDS } from "@/lib/types";
import { sortOptions } from "@/lib/constants";
import { useCurrentSearchFormState, useUpdateSearchFilter } from "@/lib/hooks";
import { YearRangePicker } from "./year-range-picker";
import { useDateRangePickerStore } from "@/lib/store";
import { RatingRangePicker } from "./rating-range-picker";
import { CountryRegionPicker } from "./country-region-picker";
import { CountryFocusPicker } from "./country-focus-picker";
import { WorkIdFilter } from "./work-id-filter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRange } from "react-day-picker";
import { ReviewFilter } from "./review-filter";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useFilterSidebarStore, getFilterSidebarDimensions } from "@/lib/store";
import { useIsMobile } from "@/lib/hooks";
import { motion, AnimatePresence } from "motion/react";

// Spring animation config for sidebar - bouncier version
const sidebarSpring = {
  type: "spring" as const,
  stiffness: 300,
  damping: 25,
  mass: 0.8,
};

const hoverSpring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 25,
  mass: 0.6,
};

interface SearchSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  isMobile?: boolean;
  mode?: "sidebar" | "sheet" | "page" | "panel";
}

// Stagger delay removed - using initial={false} pattern instead

// Filter section component for consistent styling - matches main sidebar design
interface FilterSectionProps {
  title: string;
  icon: React.ElementType;
  isActive: boolean;
  children: React.ReactNode;
  onClear?: () => void;
}

const FilterSection = React.memo(function FilterSection({
  title,
  icon: Icon,
  isActive,
  children,
  onClear,
}: FilterSectionProps) {
  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "relative rounded-xl overflow-hidden transition-all duration-200",
        "border",
        isActive
          ? "bg-sidebar-accent/80 border-border/60"
          : "bg-card/50 dark:bg-card/40 border-border/40 hover:border-border/60"
      )}
    >
      {/* Active indicator - left gradient bar */}
      {isActive && (
        <motion.div
          initial={false}
          animate={{ scaleY: 1 }}
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] rounded-r-sm bg-gradient-to-b from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)]"
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              "h-4 w-4 transition-colors duration-200",
              isActive ? "text-sidebar-primary" : "text-muted-foreground"
            )}
          />
          <span
            className={cn(
              "text-sm font-medium transition-colors duration-200",
              isActive ? "text-sidebar-primary" : "text-foreground"
            )}
          >
            {title}
          </span>
        </div>
        {isActive && onClear && (
          <motion.div
            initial={false}
            animate={{ opacity: 1, scale: 1 }}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </motion.div>
        )}
      </div>

      {/* Content */}
      <div className="px-4 pb-4">{children}</div>
    </motion.div>
  );
});

// Date Filter Component
const DateFilterPanel = React.memo(function DateFilterPanel() {
  const { dateRange, filterType, isYearRangeEnabled, yearRange } =
    useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  // Global popover open state so it persists across parent rerenders
  const { isOpen: isDatePickerOpen, setIsOpen: setIsDatePickerOpen } =
    useDateRangePickerStore();

  // Local (uncommitted) state while the popover is open. This avoids triggering
  // global store updates – and thus parent re-renders – on every date click.
  const [tempDateRange, setTempDateRange] = React.useState<
    DateRange | undefined
  >(dateRange);

  const isDateActive = isDateFilterActive(
    dateRange,
    yearRange,
    filterType,
    isYearRangeEnabled
  );

  const handleFilterTypeChange = React.useCallback(async (type: "date" | "year") => {
    updateFilter({ filterType: type });
  }, [updateFilter]);

  // Commit the selected range to the global store (and server) only once – when
  // the popover closes or the user explicitly clears the filter.
  const commitDateRange = React.useCallback(async (range: DateRange | undefined) => {
    updateFilter({ dateRange: range });
  }, [updateFilter]);

  const handleClearDateRange = React.useCallback(async () => {
    setTempDateRange(undefined);
    updateFilter({
      dateRange: undefined,
      filterType: DEFAULT_FILTERS.filterType,
      yearRange: DEFAULT_FILTERS.yearRange(),
      isYearRangeEnabled: DEFAULT_FILTERS.isYearRangeEnabled,
    });
  }, [updateFilter]);

  const handleClearYearRange = React.useCallback(async () => {
    const defaultRange = DEFAULT_FILTERS.yearRange();
    updateFilter({
      yearRange: defaultRange,
      isYearRangeEnabled: DEFAULT_FILTERS.isYearRangeEnabled,
    });
  }, [updateFilter]);

  const handlePopoverOpenChange = React.useCallback(async (open: boolean) => {
    if (open) {
      // Reset local state to reflect current global value whenever the popover opens
      setTempDateRange(dateRange);
    } else {
      // When closing, persist the selection if it changed
      await commitDateRange(tempDateRange);
    }
    setIsDatePickerOpen(open);
  }, [dateRange, tempDateRange, commitDateRange, setIsDatePickerOpen]);

  const handleClearFilter = React.useCallback(() => {
    if (filterType === "date") {
      handleClearDateRange();
    } else {
      handleClearYearRange();
    }
  }, [filterType, handleClearDateRange, handleClearYearRange]);

  return (
    <FilterSection
      title="Publication timeframe"
      icon={Clock}
      isActive={isDateActive}
      onClear={isDateActive ? handleClearFilter : undefined}
    >
      <div className="space-y-3">
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
            Date range
          </button>
        </div>

        {/* Filter Content */}
        {filterType === "date" ? (
          <Popover
            open={isDatePickerOpen}
            onOpenChange={handlePopoverOpenChange}
          >
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full h-10 justify-start text-left font-normal",
                  isDateActive && dateRange?.from
                    ? "border-sidebar-primary/50"
                    : "border-dashed border-muted-foreground/30"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                {isDateActive && dateRange?.from ? (
                  dateRange.to ? (
                    <span className="truncate text-sm">
                      {format(dateRange.from, "MMM dd, yyyy")} →{" "}
                      {format(dateRange.to, "MMM dd, yyyy")}
                    </span>
                  ) : (
                    <span className="truncate text-sm">
                      From {format(dateRange.from, "MMM dd, yyyy")}
                    </span>
                  )
                ) : (
                  <span className="text-muted-foreground text-sm">
                    Choose date range
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                initialFocus
                mode="range"
                defaultMonth={dateRange?.from}
                selected={tempDateRange}
                onSelect={(range) => {
                  setTempDateRange(range);
                }}
                numberOfMonths={2}
                captionLayout="dropdown"
              />
            </PopoverContent>
          </Popover>
        ) : (
          <YearRangePicker />
        )}
      </div>
    </FilterSection>
  );
});

// Rating Filter Component
const RatingFilterPanel = React.memo(function RatingFilterPanel() {
  const { ratingRange, onlyRatedPapers } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isRatingActive = isRatingFilterActive(ratingRange, onlyRatedPapers);

  const handleClearRatingFilter = React.useCallback(() => {
    updateFilter({
      ratingRange: DEFAULT_FILTERS.ratingRange,
      onlyRatedPapers: DEFAULT_FILTERS.onlyRatedPapers,
    });
  }, [updateFilter]);

  return (
    <FilterSection
      title="Rating filter"
      icon={Star}
      isActive={isRatingActive}
      onClear={isRatingActive ? handleClearRatingFilter : undefined}
    >
      <RatingRangePicker />
    </FilterSection>
  );
});

// Institution Location Filter Component
const InstitutionLocationFilterPanel = React.memo(function InstitutionLocationFilterPanel() {
  const { selectedRegions } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isCountryActive = isCountryFilterActive(selectedRegions);

  const handleClearFilter = React.useCallback(() => {
    updateFilter({ selectedRegions: DEFAULT_FILTERS.selectedRegions });
  }, [updateFilter]);

  return (
    <FilterSection
      title="Institution location"
      icon={Globe}
      isActive={isCountryActive}
      onClear={isCountryActive ? handleClearFilter : undefined}
    >
      <CountryRegionPicker />
    </FilterSection>
  );
});

// Country Focus Filter Component
const CountryFocusFilterPanel = React.memo(function CountryFocusFilterPanel() {
  const { selectedCountryFocus } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  
  // Check if country focus is active (using the same utility pattern)
  const isCountryFocusFilterActive = selectedCountryFocus && selectedCountryFocus.length > 0;

  const handleClearFilter = React.useCallback(() => {
    updateFilter({ selectedCountryFocus: DEFAULT_FILTERS.selectedCountryFocus });
  }, [updateFilter]);

  return (
    <FilterSection
      title="Country focus"
      icon={Focus}
      isActive={isCountryFocusFilterActive}
      onClear={isCountryFocusFilterActive ? handleClearFilter : undefined}
    >
      <CountryFocusPicker />
    </FilterSection>
  );
});

// Search Field Component - now a dropdown select
const SearchFieldPanel = React.memo(function SearchFieldPanel() {
  const { currentSearchField } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const handleSearchFieldChange = React.useCallback((field: string) => {
    updateFilter({ currentSearchField: field as SearchField });
  }, [updateFilter]);

  const handleClearFilter = React.useCallback(() => {
    updateFilter({ currentSearchField: DEFAULT_FILTERS.field });
  }, [updateFilter]);

  // Find current field label
  const currentFieldLabel =
    SEARCH_FIELDS.find((f) => f.value === currentSearchField)?.label ||
    "Title & Abstract";

  // Check if search field is not at default
  const isSearchFieldActive = currentSearchField !== DEFAULT_FILTERS.field;

  return (
    <FilterSection
      title="Search scope"
      icon={Target}
      isActive={isSearchFieldActive}
      onClear={isSearchFieldActive ? handleClearFilter : undefined}
    >
      <Select value={currentSearchField} onValueChange={handleSearchFieldChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select search scope">
            {currentFieldLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SEARCH_FIELDS.map((field) => (
            <SelectItem key={field.value} value={field.value}>
              {field.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterSection>
  );
});

// Sort Options Component - now a dropdown select
const SortOptionsPanel = React.memo(function SortOptionsPanel() {
  const { sortBy } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();

  const handleSortChange = React.useCallback((sort: string) => {
    updateFilter({ sortBy: sort });
  }, [updateFilter]);

  const handleClearFilter = React.useCallback(() => {
    updateFilter({ sortBy: DEFAULT_FILTERS.sortBy });
  }, [updateFilter]);

  // Find current sort label
  const currentSortLabel =
    sortOptions.find((o) => o.value === sortBy)?.label || "Relevance";

  // Check if sort is not at default
  const isSortActive = sortBy !== DEFAULT_FILTERS.sortBy;

  return (
    <FilterSection
      title="Sort results by"
      icon={SortAsc}
      isActive={isSortActive}
      onClear={isSortActive ? handleClearFilter : undefined}
    >
      <Select value={sortBy} onValueChange={handleSortChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select sort order">
            {currentSortLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterSection>
  );
});

// Cites Filter Component
const CitesFilterPanel = React.memo(function CitesFilterPanel() {
  const { citesItemId } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isCitesActive = isCitesFilterActive(citesItemId);

  const handleClearCitesFilter = React.useCallback(() => {
    updateFilter({ citesItemId: DEFAULT_FILTERS.citesItemId });
  }, [updateFilter]);

  return (
    <FilterSection
      title="Citation filter"
      icon={Quote}
      isActive={isCitesActive}
      onClear={isCitesActive ? handleClearCitesFilter : undefined}
    >
      <WorkIdFilter type="cites" />
    </FilterSection>
  );
});

// Cited By Filter Component
const CitedByFilterPanel = React.memo(function CitedByFilterPanel() {
  const { citedByItemId } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isCitedByActive = isCitedByFilterActive(citedByItemId);

  const handleClearCitedByFilter = React.useCallback(() => {
    updateFilter({ citedByItemId: DEFAULT_FILTERS.citedByItemId });
  }, [updateFilter]);

  return (
    <FilterSection
      title="Cited by filter"
      icon={Quote}
      isActive={isCitedByActive}
      onClear={isCitedByActive ? handleClearCitedByFilter : undefined}
    >
      <WorkIdFilter type="cited_by" />
    </FilterSection>
  );
});

// Related To Filter Component
const RelatedToFilterPanel = React.memo(function RelatedToFilterPanel() {
  const { relatedToItemId } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isRelatedToActive = isRelatedToFilterActive(relatedToItemId);

  const handleClearRelatedToFilter = React.useCallback(() => {
    updateFilter({ relatedToItemId: DEFAULT_FILTERS.relatedToItemId });
  }, [updateFilter]);

  return (
    <FilterSection
      title="Related works filter"
      icon={Network}
      isActive={isRelatedToActive}
      onClear={isRelatedToActive ? handleClearRelatedToFilter : undefined}
    >
      <WorkIdFilter type="related" />
    </FilterSection>
  );
});

// Review Filter Component
const ReviewFilterPanel = React.memo(function ReviewFilterPanel() {
  const { reviewFilter } = useCurrentSearchFormState();
  const updateFilter = useUpdateSearchFilter();
  const isReviewActive = isReviewFilterActive(reviewFilter);

  const handleClearReviewFilter = React.useCallback(() => {
    updateFilter({ reviewFilter: DEFAULT_FILTERS.reviewFilter });
  }, [updateFilter]);

  return (
    <FilterSection
      title="Review filter"
      icon={FileText}
      isActive={isReviewActive}
      onClear={isReviewActive ? handleClearReviewFilter : undefined}
    >
      <ReviewFilter />
    </FilterSection>
  );
});

// Sidebar Content Component - extracted and memoized
interface SidebarContentProps {
  hideHeader?: boolean;
  isMobileSheet?: boolean;
  activeFiltersCount: number;
  isCitesActive: boolean;
  isCitedByActive: boolean;
  isRelatedToActive: boolean;
  onClearAllFilters: () => void;
}

const SidebarContent = React.memo(function SidebarContent({
  hideHeader = false,
  isMobileSheet = false,
  activeFiltersCount,
  isCitesActive,
  isCitedByActive,
  isRelatedToActive,
  onClearAllFilters,
}: SidebarContentProps) {
  return (
    <div className={cn("space-y-4", isMobileSheet ? "p-4" : "p-4 pt-15")}>
      {/* Simple Header - hidden when using panel mode with external header */}
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Filters</h2>
          {activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearAllFilters}
              className="text-xs h-7 px-3 text-muted-foreground hover:text-foreground"
            >
              Clear all ({activeFiltersCount})
            </Button>
          )}
        </div>
      )}

      {/* ID Filters - Show at top when active */}
      {isCitesActive && <CitesFilterPanel />}
      {isCitedByActive && <CitedByFilterPanel />}
      {isRelatedToActive && <RelatedToFilterPanel />}

      {/* Date Filter */}
      <DateFilterPanel />

      {/* Rating Filter */}
      <RatingFilterPanel />

      {/* Institution Location Filter */}
      <InstitutionLocationFilterPanel />

      {/* Country focus Filter */}
      <CountryFocusFilterPanel />

      {/* Search Field - Dropdown */}
      <SearchFieldPanel />

      {/* Sort Options - Dropdown */}
      <SortOptionsPanel />

      {/* Review Filter */}
      <ReviewFilterPanel />

      {/* Cites Filter (when not active) */}
      {!isCitesActive && <CitesFilterPanel />}

      {/* Cited By Filter (when not active) */}
      {!isCitedByActive && <CitedByFilterPanel />}

      {/* Related To Filter (when not active) */}
      {!isRelatedToActive && <RelatedToFilterPanel />}
    </div>
  );
});

export function SearchSidebar({
  isOpen,
  onClose,
  isMobile = false,
  mode = "sidebar",
}: SearchSidebarProps) {
  const toggle = useFilterSidebarStore((s) => s.toggle);

  // Keyboard shortcut: Ctrl+Shift+F to toggle filter sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        toggle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

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

  // Only compute filter states needed for conditional UI rendering
  // Other filter states are computed inside their respective filter panel components
  const isCitesActive = isCitesFilterActive(citesItemId);
  const isCitedByActive = isCitedByFilterActive(citedByItemId);
  const isRelatedToActive = isRelatedToFilterActive(relatedToItemId);

  const handleClearAllFilters = React.useCallback(() => {
    const defaultYearRange = DEFAULT_FILTERS.yearRange();
    updateFilter({
      currentSearchField: DEFAULT_FILTERS.field,
      sortBy: DEFAULT_FILTERS.sortBy,
      filterType: DEFAULT_FILTERS.filterType,
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
  }, [updateFilter]);

  // Use shared filter counting logic (single source of truth)
  const activeFiltersCount = countActiveFilters({
    field: currentSearchField,
    sortBy,
    yearRange,
    dateRange,
    filterType,
    isYearRangeEnabled,
    selectedRegions,
    selectedCountryFocus,
    ratingRange,
    onlyRatedPapers,
    citesItemId,
    citedByItemId,
    relatedToItemId,
    reviewFilter,
  });

  if (mode === "sheet") {
    return (
      <Sheet open={isOpen} onOpenChange={onClose}>
        <SheetContent
          side="right"
          className="w-80 p-0 bg-background border-r overflow-hidden flex flex-col"
        >
          <SheetHeader className="px-4 py-3 border-b bg-background">
            <SheetTitle>Search Filters</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto">
            <SidebarContent
              hideHeader
              isMobileSheet={isMobile}
              activeFiltersCount={activeFiltersCount}
              isCitesActive={isCitesActive}
              isCitedByActive={isCitedByActive}
              isRelatedToActive={isRelatedToActive}
              onClearAllFilters={handleClearAllFilters}
            />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (mode === "page") {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <SidebarContent
          hideHeader={true}
          isMobileSheet={isMobile}
          activeFiltersCount={activeFiltersCount}
          isCitesActive={isCitesActive}
          isCitedByActive={isCitedByActive}
          isRelatedToActive={isRelatedToActive}
          onClearAllFilters={handleClearAllFilters}
        />
      </div>
    );
  }

  if (mode === "panel") {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const isMobile = useIsMobile();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { isCollapsed, toggle, _hasHydrated } = useFilterSidebarStore();
    const { expandedWidth, collapsedWidth } = getFilterSidebarDimensions(isCollapsed);

    // Don't render until hydrated or on mobile
    if (!_hasHydrated || isMobile) return null;

    // Calculate translateX - when collapsed, slide left so only collapsedWidth is visible
    const translateX = isCollapsed ? -(expandedWidth - collapsedWidth) : 0;

    // Wrapper that controls width for layout
    return (
      <div 
        className="h-full relative"
        style={{ 
          width: isCollapsed ? collapsedWidth : expandedWidth,
          transition: `width ${sidebarSpring.stiffness}ms ease-out`
        }}
      >
        {/* Sidebar that translates */}
        <motion.aside
          className={cn(
            "h-full flex flex-col overflow-hidden absolute right-0 top-0 bottom-0",
            "bg-background/80 dark:bg-background/60",
            "backdrop-blur-xl backdrop-saturate-150",
            "border-l border-border/50"
          )}
          initial={false}
          animate={{ x: translateX }}
          transition={sidebarSpring}
          style={{ width: expandedWidth }}
        >
          {/* Subtle gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-transparent pointer-events-none" />

          {/* Floating controls in top-right corner */}
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1 bg-background/60 backdrop-blur-sm rounded-lg p-1 border border-border/30">
            <AnimatePresence>
              {activeFiltersCount > 0 && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-1"
                >
                  <span className="flex items-center justify-center h-7 min-w-7 px-2 text-xs font-medium rounded-md bg-gradient-to-r from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)] text-white badge-glow">
                    {activeFiltersCount}
                  </span>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        transition={hoverSpring}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={handleClearAllFilters}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </motion.div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Clear all filters
                    </TooltipContent>
                  </Tooltip>
                </motion.div>
              )}
            </AnimatePresence>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  transition={hoverSpring}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggle}
                    className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80 transition-all duration-200"
                  >
                    <motion.div
                      animate={{ rotate: 0 }}
                      whileHover={{ rotate: isCollapsed ? 90 : -90 }}
                      transition={{ duration: 0.3 }}
                    >
                      <Filter className="h-4 w-4" />
                    </motion.div>
                  </Button>
                </motion.div>
              </TooltipTrigger>
              <TooltipContent side="left">
                {isCollapsed ? "Expand" : "Collapse"} filters (Ctrl+Shift+F)
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Scrollable content with hidden scrollbar */}
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
            <SidebarContent
              hideHeader
              activeFiltersCount={activeFiltersCount}
              isCitesActive={isCitesActive}
              isCitedByActive={isCitedByActive}
              isRelatedToActive={isRelatedToActive}
              onClearAllFilters={handleClearAllFilters}
            />
          </div>
        </motion.aside>

        {/* Fixed controls that stay visible when collapsed */}
        <AnimatePresence>
          {isCollapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute top-4 right-0 z-20 flex flex-col items-center gap-2"
            >
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    transition={hoverSpring}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={toggle}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/80 transition-all duration-200"
                    >
                      <motion.div
                        animate={{ rotate: 0 }}
                        whileHover={{ rotate: 90 }}
                        transition={{ duration: 0.3 }}
                      >
                        <Filter className="h-4 w-4" />
                      </motion.div>
                    </Button>
                  </motion.div>
                </TooltipTrigger>
                <TooltipContent side="left">
                  Expand filters (Ctrl+Shift+F)
                </TooltipContent>
              </Tooltip>

              {/* Filter count badge and clear button */}
              {activeFiltersCount > 0 && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ duration: 0.15, delay: 0.1 }}
                  className="flex flex-col items-center gap-2"
                >
                  <span className="flex items-center justify-center h-7 w-7 text-xs font-medium rounded-md bg-gradient-to-r from-[oklch(0.75_0.15_55)] via-[oklch(0.70_0.17_54)] to-[oklch(0.62_0.16_52)] text-white badge-glow">
                    {activeFiltersCount}
                  </span>
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      <motion.div
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        transition={hoverSpring}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={handleClearAllFilters}
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </motion.div>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      Clear all filters
                    </TooltipContent>
                  </Tooltip>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-80 rounded-2xl overflow-hidden",
        "bg-background/80 dark:bg-background/60",
        "backdrop-blur-xl backdrop-saturate-150",
        "border border-border/50",
        "shadow-lg shadow-black/[0.03] dark:shadow-black/[0.1]"
      )}
    >
      <SidebarContent
        activeFiltersCount={activeFiltersCount}
        isCitesActive={isCitesActive}
        isCitedByActive={isCitedByActive}
        isRelatedToActive={isRelatedToActive}
        onClearAllFilters={handleClearAllFilters}
      />
    </div>
  );
}
