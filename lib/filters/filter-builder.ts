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

/** Translation function for filter strings (from useTranslations("searchFilters")) */
export type FilterT = {
  (key: string, values?: Record<string, string | number>): string;
};

const FIELD_KEY_MAP: Record<string, string> = {
  title_and_abstract: "searchFieldTitleAndAbstract",
  title: "searchFieldTitle",
  abstract: "searchFieldAbstract",
  fulltext: "searchFieldFulltext",
  display_name: "searchFieldDisplayName",
};

/** Maps sortBy values (e.g. relevance_score:desc) to searchFilters translation keys */
const SORT_KEY_MAP: Record<string, string> = {
  relevance_score: "sortRelevanceDefault",
  "relevance_score:desc": "sortRelevance",
  "relevance_score:asc": "sortRelevance",
  "cited_by_count:desc": "sortCitationsDesc",
  "cited_by_count:asc": "sortCitationsAsc",
  "publication_date:desc": "sortDateDesc",
  "publication_date:asc": "sortDateAsc",
  "display_name:desc": "sortTitleDesc",
  "display_name:asc": "sortTitleAsc",
  publication_date: "filterSortPublicationDate",
  cited_by_count: "filterSortCitations",
  works_count: "filterSortWorksCount",
};

const SECTION_TITLE_KEYS: Record<FilterSectionType, string> = {
  search: "filterSectionSearch",
  time: "filterSectionTime",
  geographic: "filterSectionGeographic",
  content: "filterSectionContent",
  ratings: "filterSectionRatings",
  citations: "filterSectionCitations",
};

// ============ Helper Functions ============

/**
 * Get human-readable label for a search field
 */
export function getFieldLabel(field?: string, t?: FilterT): string {
  if (!field) return t ? t("searchFieldTitleAndAbstract") : "Title, abstract";
  const key = FIELD_KEY_MAP[field];
  if (t && key) return t(key);
  const option = SEARCH_FIELDS.find((opt) => opt.value === field);
  return option?.label || field;
}

/**
 * Get human-readable label for a sort option
 */
export function getSortLabel(sort?: string, t?: FilterT): string {
  if (!sort) return t ? t("sortRelevanceDefault") : "Relevance";
  const key = SORT_KEY_MAP[sort];
  if (t && key) return t(key);
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
  countryCount: number,
  t?: FilterT
): string {
  const parts: string[] = [];
  if (regionCount > 0) {
    parts.push(t ? t("filterRegionCount", { count: regionCount }) : `${regionCount} region${regionCount > 1 ? "s" : ""}`);
  }
  if (countryCount > 0) {
    parts.push(t ? t("filterCountryCount", { count: countryCount }) : `${countryCount} countr${countryCount > 1 ? "ies" : "y"}`);
  }
  const join = t ? t("filterGeoJoin") : " + ";
  return parts.join(join);
}

/**
 * Format rating range for display (e.g., "3-5 stars")
 */
export function formatRatingRange(
  range: [number, number],
  t?: FilterT
): string {
  const [min, max] = range;
  if (t) {
    return min === max
      ? t("filterRatingRangeSingle", { min })
      : t("filterRatingRangeMulti", { min, max });
  }
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
  onlyRated?: boolean,
  t?: FilterT
): string {
  const parts: string[] = [];
  if (range && (range[0] > 0 || range[1] < 5)) {
    const [min, max] = range;
    if (t) {
      parts.push(
        min === max
          ? t("filterRatingRangeSingle", { min })
          : t("filterRatingRangeMulti", { min, max })
      );
    } else {
      parts.push(
        `${min === max ? min : `${min}-${max}`} star${min === 1 && max === 1 ? "" : "s"}`
      );
    }
  }
  if (onlyRated) {
    parts.push(t ? t("filterRatedOnly") : "rated only");
  }
  return parts.length > 0 ? parts.join(", ") : (t ? t("filterFiltered") : "filtered");
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
  items: FilterItem[],
  t?: FilterT
): FilterSection {
  const config = SECTION_CONFIG[type];
  const title = t ? t(SECTION_TITLE_KEYS[type]) : config.title;
  return {
    id: type,
    title,
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

/** Optional date formatter for localized date display (e.g. from useFormatter().dateTime) */
export type FormatDateTimeFn = (
  date: Date,
  options?: Intl.DateTimeFormatOptions
) => string;

/**
 * Build structured filter data from search parameters
 * This is the single source of truth for filter display logic
 */
export function buildFilterData(
  params: FilterParams,
  t?: FilterT,
  formatDateTime?: FormatDateTimeFn
): FilterSection[] {
  const sections: FilterSection[] = [];

  // Search section (field + sort) - only include when different from defaults
  const searchItems: FilterItem[] = [];
  if (params.field && params.field !== DEFAULT_FILTERS.field) {
    searchItems.push(
      createFilterItem(
        "field",
        "field",
        getFieldLabel(params.field, t),
        t ? t("filterLabelField") : "Field"
      )
    );
  }
  if (params.sortBy && params.sortBy !== DEFAULT_FILTERS.sortBy) {
    searchItems.push(
      createFilterItem(
        "sort",
        "sort",
        getSortLabel(params.sortBy, t),
        t ? t("filterLabelSort") : "Sort"
      )
    );
  }
  if (searchItems.length > 0) {
    sections.push(createSection("search", searchItems, t));
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
      timeItems.push(
        createFilterItem(
          "year",
          "year",
          displayValue,
          t ? t("filterLabelYear") : "Year"
        )
      );
    } else if (params.filterType === "date" && params.dateRange?.from) {
      const dateOpts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
      const from = formatDateTime
        ? formatDateTime(params.dateRange.from, dateOpts)
        : format(params.dateRange.from, "MMM dd, yyyy");
      const to = params.dateRange.to
        ? formatDateTime
          ? formatDateTime(params.dateRange.to, dateOpts)
          : format(params.dateRange.to, "MMM dd, yyyy")
        : t ? t("filterNow") : "now";
      timeItems.push(
        createFilterItem(
          "date",
          "date",
          `${from} - ${to}`,
          t ? t("filterLabelDate") : "Date"
        )
      );
    }
  }
  if (timeItems.length > 0) {
    sections.push(createSection("time", timeItems, t));
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
        formatGeoSummary(regionCount, countryCodes.length, t),
        t ? t("filterLabelInstitutionLocation") : "Institution location",
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
        formatGeoSummary(regionCount, countryCodes.length, t),
        t ? t("filterLabelCountryFocus") : "Country focus",
        { countryCodes }
      )
    );
  }
  if (geoItems.length > 0) {
    sections.push(createSection("geographic", geoItems, t));
  }

  // Content section (review filter only - language is shown separately in history cards)
  const contentItems: FilterItem[] = [];
  if (isReviewFilterActive(params.reviewFilter)) {
    contentItems.push(
      createFilterItem(
        "review",
        "review",
        t ? t("filterReviewsOnly") : "Reviews only",
        t ? t("filterReviewsOnly") : "Reviews only"
      )
    );
  }
  if (contentItems.length > 0) {
    sections.push(createSection("content", contentItems, t));
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
          formatRatingRange(params.ratingRange, t),
          t ? t("filterRating") : "Rating",
          { ratingRange: params.ratingRange }
        )
      );
    }
    if (params.onlyRatedPapers) {
      ratingItems.push(
        createFilterItem(
          "onlyRated",
          "onlyRated",
          t ? t("filterRatedOnlyLabel") : "Rated only",
          t ? t("filterRatedOnlyLabel") : "Rated only"
        )
      );
    }
  }
  if (ratingItems.length > 0) {
    sections.push(createSection("ratings", ratingItems, t));
  }

  // Citations section
  const citationItems: FilterItem[] = [];
  if (isCitesFilterActive(params.citesItemId)) {
    citationItems.push(
      createFilterItem(
        "cites",
        "cites",
        params.citesItemId!,
        t ? t("filterCites") : "Cites"
      )
    );
  }
  if (isCitedByFilterActive(params.citedByItemId)) {
    citationItems.push(
      createFilterItem(
        "citedBy",
        "citedBy",
        params.citedByItemId!,
        t ? t("filterCitedBy") : "Cited by"
      )
    );
  }
  if (isRelatedToFilterActive(params.relatedToItemId)) {
    citationItems.push(
      createFilterItem(
        "relatedTo",
        "relatedTo",
        params.relatedToItemId!,
        t ? t("filterRelatedTo") : "Related to"
      )
    );
  }
  if (citationItems.length > 0) {
    sections.push(createSection("citations", citationItems, t));
  }

  return sections;
}

/**
 * Count total active filters from params
 * Useful for displaying filter count badges
 */
export function countActiveFilters(
  params: FilterParams,
  t?: FilterT,
  formatDateTime?: FormatDateTimeFn
): number {
  const sections = buildFilterData(params, t, formatDateTime);
  return sections.reduce((count, section) => count + section.items.length, 0);
}

/**
 * Get all filter items as a flat array
 * Useful for rendering inline badges
 */
export function getAllFilterItems(
  params: FilterParams,
  t?: FilterT,
  formatDateTime?: FormatDateTimeFn
): FilterItem[] {
  const sections = buildFilterData(params, t, formatDateTime);
  return sections.flatMap((section) => section.items);
}
