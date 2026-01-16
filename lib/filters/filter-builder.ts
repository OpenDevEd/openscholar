/**
 * Filter Builder
 * Core logic for building structured filter data from search parameters
 */

import { format } from "date-fns";
import { SEARCH_FIELDS } from "@/lib/types/search.types";
import { COUNTRIES } from "@/lib/constants";
import {
  DEFAULT_FILTERS,
  isDateFilterActive,
  isCountryFilterActive,
  isCountryFocusActive,
  isRatingFilterActive,
  isReviewFilterActive,
  isCitesFilterActive,
  isCitedByFilterActive,
  isRelatedToFilterActive,
} from "@/lib/utils";
import {
  FilterParams,
  FilterSection,
  FilterItem,
  FilterSectionType,
} from "./filter-types";
import {
  SECTION_CONFIG,
  FILTER_ICONS,
  FILTER_EMOJIS,
  SORT_OPTIONS,
} from "./filter-config";

// ============ Helper Functions ============

/**
 * Get human-readable label for a search field
 */
export function getFieldLabel(field?: string): string {
  if (!field) return "Title, abstract";
  const option = SEARCH_FIELDS.find((opt) => opt.value === field);
  return option?.label || field;
}

/**
 * Get human-readable label for a sort option
 */
export function getSortLabel(sort?: string): string {
  if (!sort) return "Relevance";
  const option = SORT_OPTIONS.find((opt) => opt.value === sort);
  return option?.label || sort;
}

/**
 * Extract valid country codes from a list of region/country IDs
 */
export function extractCountryCodes(ids: string[]): string[] {
  return ids.filter((id) => id.length === 2 && COUNTRIES[id]);
}

/**
 * Count regions (non-country IDs) from a list
 */
export function countRegions(ids: string[]): number {
  return ids.filter((id) => !(id.length === 2 && COUNTRIES[id])).length;
}

/**
 * Format geographic filter summary (e.g., "2 regions + 3 countries")
 */
export function formatGeoSummary(
  regionCount: number,
  countryCount: number
): string {
  const parts: string[] = [];
  if (regionCount > 0) {
    parts.push(`${regionCount} region${regionCount > 1 ? "s" : ""}`);
  }
  if (countryCount > 0) {
    parts.push(`${countryCount} countr${countryCount > 1 ? "ies" : "y"}`);
  }
  return parts.join(" + ");
}

/**
 * Format rating range for display (e.g., "3-5 stars")
 */
export function formatRatingRange(range: [number, number]): string {
  const [min, max] = range;
  if (min === max) {
    return `${min} star${min === 1 ? "" : "s"}`;
  }
  return `${min}-${max} stars`;
}

/**
 * Format rating summary for history badges
 */
export function formatRatingSummary(
  range?: [number, number],
  onlyRated?: boolean
): string {
  const parts: string[] = [];
  if (range && (range[0] > 0 || range[1] < 5)) {
    const [min, max] = range;
    parts.push(
      `${min === max ? min : `${min}-${max}`} star${min === 1 && max === 1 ? "" : "s"}`
    );
  }
  if (onlyRated) {
    parts.push("rated only");
  }
  return parts.length > 0 ? parts.join(", ") : "filtered";
}

/**
 * Check if a SearchResult has any active filters
 * Used by history components to show filter indicators
 */
export function hasActiveFiltersFromResult(result: {
  yearRange?: [number, number];
  dateRange?: { from?: Date; to?: Date };
  selectedRegions?: string[];
  selectedCountryFocus?: string[];
  citesItemId?: string;
  citedByItemId?: string;
  relatedToItemId?: string;
  ratingRange?: [number, number];
  reviewFilter?: boolean;
  onlyRatedPapers?: boolean;
}): boolean {
  return !!(
    result.yearRange ||
    result.dateRange ||
    (result.selectedRegions && result.selectedRegions.length > 0) ||
    (result.selectedCountryFocus && result.selectedCountryFocus.length > 0) ||
    result.citesItemId ||
    result.citedByItemId ||
    result.relatedToItemId ||
    result.ratingRange ||
    result.reviewFilter ||
    result.onlyRatedPapers
  );
}

// ============ Section Builder Helpers ============

function createSection(
  type: FilterSectionType,
  items: FilterItem[]
): FilterSection {
  const config = SECTION_CONFIG[type];
  return {
    id: type,
    title: config.title,
    tooltipColor: config.tooltipColor,
    badgeColor: config.badgeColor,
    items,
  };
}

function createFilterItem(
  key: string,
  type: FilterItem["type"],
  displayValue: string,
  label: string,
  extra?: Partial<Pick<FilterItem, "countryCodes" | "ratingRange">>
): FilterItem {
  return {
    key,
    type,
    icon: FILTER_ICONS[type],
    emoji: FILTER_EMOJIS[type],
    label,
    displayValue,
    ...extra,
  };
}

// ============ Main Builder Function ============

/**
 * Build structured filter data from search parameters
 * This is the single source of truth for filter display logic
 */
export function buildFilterData(params: FilterParams): FilterSection[] {
  const sections: FilterSection[] = [];

  // Search section (field + sort) - only include when different from defaults
  const searchItems: FilterItem[] = [];
  if (params.field && params.field !== DEFAULT_FILTERS.field) {
    searchItems.push(
      createFilterItem("field", "field", getFieldLabel(params.field), "Field")
    );
  }
  if (params.sortBy && params.sortBy !== DEFAULT_FILTERS.sortBy) {
    searchItems.push(
      createFilterItem("sort", "sort", getSortLabel(params.sortBy), "Sort")
    );
  }
  if (searchItems.length > 0) {
    sections.push(createSection("search", searchItems));
  }

  // Time section (year or date range)
  const timeItems: FilterItem[] = [];
  if (
    isDateFilterActive(
      params.dateRange,
      params.yearRange,
      params.filterType,
      params.isYearRangeEnabled
    )
  ) {
    if (params.filterType === "year" && params.yearRange) {
      const [from, to] = params.yearRange;
      const displayValue = from === to ? `${from}` : `${from} - ${to}`;
      timeItems.push(createFilterItem("year", "year", displayValue, "Year"));
    } else if (params.filterType === "date" && params.dateRange?.from) {
      const from = format(params.dateRange.from, "MMM dd, yyyy");
      const to = params.dateRange.to
        ? format(params.dateRange.to, "MMM dd, yyyy")
        : "now";
      timeItems.push(
        createFilterItem("date", "date", `${from} - ${to}`, "Date")
      );
    }
  }
  if (timeItems.length > 0) {
    sections.push(createSection("time", timeItems));
  }

  // Geographic section (regions + country focus)
  const geoItems: FilterItem[] = [];
  if (isCountryFilterActive(params.selectedRegions)) {
    const countryCodes = extractCountryCodes(params.selectedRegions!);
    const regionCount = countRegions(params.selectedRegions!);
    geoItems.push(
      createFilterItem(
        "regions",
        "regions",
        formatGeoSummary(regionCount, countryCodes.length),
        "Institution location",
        { countryCodes }
      )
    );
  }
  if (isCountryFocusActive(params.selectedCountryFocus)) {
    const countryCodes = extractCountryCodes(params.selectedCountryFocus!);
    const regionCount = countRegions(params.selectedCountryFocus!);
    geoItems.push(
      createFilterItem(
        "countryFocus",
        "countryFocus",
        formatGeoSummary(regionCount, countryCodes.length),
        "Country focus",
        { countryCodes }
      )
    );
  }
  if (geoItems.length > 0) {
    sections.push(createSection("geographic", geoItems));
  }

  // Content section (review filter only - language is shown separately in history cards)
  const contentItems: FilterItem[] = [];
  if (isReviewFilterActive(params.reviewFilter)) {
    contentItems.push(
      createFilterItem("review", "review", "Reviews only", "Reviews only")
    );
  }
  if (contentItems.length > 0) {
    sections.push(createSection("content", contentItems));
  }

  // Ratings section
  const ratingItems: FilterItem[] = [];
  if (isRatingFilterActive(params.ratingRange, params.onlyRatedPapers)) {
    if (
      params.ratingRange &&
      (params.ratingRange[0] !== 0 || params.ratingRange[1] !== 5)
    ) {
      ratingItems.push(
        createFilterItem(
          "rating",
          "rating",
          formatRatingRange(params.ratingRange),
          "Rating",
          { ratingRange: params.ratingRange }
        )
      );
    }
    if (params.onlyRatedPapers) {
      ratingItems.push(
        createFilterItem("onlyRated", "onlyRated", "Rated only", "Rated only")
      );
    }
  }
  if (ratingItems.length > 0) {
    sections.push(createSection("ratings", ratingItems));
  }

  // Citations section
  const citationItems: FilterItem[] = [];
  if (isCitesFilterActive(params.citesItemId)) {
    citationItems.push(
      createFilterItem("cites", "cites", params.citesItemId!, "Cites")
    );
  }
  if (isCitedByFilterActive(params.citedByItemId)) {
    citationItems.push(
      createFilterItem("citedBy", "citedBy", params.citedByItemId!, "Cited by")
    );
  }
  if (isRelatedToFilterActive(params.relatedToItemId)) {
    citationItems.push(
      createFilterItem(
        "relatedTo",
        "relatedTo",
        params.relatedToItemId!,
        "Related to"
      )
    );
  }
  if (citationItems.length > 0) {
    sections.push(createSection("citations", citationItems));
  }

  return sections;
}

/**
 * Count total active filters from params
 * Useful for displaying filter count badges
 */
export function countActiveFilters(params: FilterParams): number {
  const sections = buildFilterData(params);
  return sections.reduce((count, section) => count + section.items.length, 0);
}

/**
 * Get all filter items as a flat array
 * Useful for rendering inline badges
 */
export function getAllFilterItems(params: FilterParams): FilterItem[] {
  const sections = buildFilterData(params);
  return sections.flatMap((section) => section.items);
}
