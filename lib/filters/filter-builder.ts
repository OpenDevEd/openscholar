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
import { SECTION_TITLES, FILTER_ICONS, SORT_OPTIONS } from "./filter-config";
import { INSTITUTION_TYPES, SDGS, WORK_TYPES } from "@/lib/openalex/vocabulary";

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
  oql: "searchFieldOql",
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
  researchAreas?: string[];
  sdgs?: string[];
  openAccessOnly?: boolean;
  workTypes?: string[];
  workLanguages?: string[];
  institutionTypes?: string[];
  funders?: string[];
  authors?: string[];
  minCitations?: number | null;
  hasAbstract?: boolean;
  includeRetracted?: boolean;
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
    result.onlyRatedPapers ||
    result.researchAreas?.length ||
    result.sdgs?.length ||
    result.openAccessOnly ||
    result.workTypes?.length ||
    result.workLanguages?.length ||
    result.institutionTypes?.length ||
    result.funders?.length ||
    result.authors?.length ||
    result.minCitations ||
    result.hasAbstract ||
    result.includeRetracted
  );
}

// ============ Section Builder Helpers ============

function createSection(
  type: FilterSectionType,
  items: FilterItem[],
  t?: FilterT
): FilterSection {
  return {
    id: type,
    title: t ? t(SECTION_TITLE_KEYS[type]) : SECTION_TITLES[type],
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
 * Names the builder cannot know on its own: research areas come from the topic
 * catalog, and places are named in the reader's language.
 */
export type FilterNames = {
  researchAreas?: Record<string, string>;
  funders?: Record<string, string>;
  authors?: Record<string, string>;
  place?: (codeOrRegionId: string) => string;
  language?: (code: string) => string;
};
const namesOf = (ids: string[], options: readonly { id: string; name: string }[]) =>
  ids.map((id) => options.find((option) => option.id === id)?.name ?? id).join(", ");

/**
 * Build structured filter data from search parameters
 * This is the single source of truth for filter display logic
 */
export function buildFilterData(
  params: FilterParams,
  t?: FilterT,
  formatDateTime?: FormatDateTimeFn,
  names: FilterNames = {}
): FilterSection[] {
  const sections: FilterSection[] = [];
  const placeNames = (ids: string[]) =>
    ids.map((id) => names.place?.(id) ?? COUNTRIES[id] ?? id).join(", ");

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
    geoItems.push(
      createFilterItem(
        "regions",
        "regions",
        placeNames(params.selectedRegions!),
        t ? t("filterLabelInstitutionLocation") : "Institution location",
        { countryCodes }
      )
    );
  }
  if (isCountryFocusActive(params.selectedCountryFocus)) {
    const countryCodes = extractCountryCodes(params.selectedCountryFocus!);
    geoItems.push(
      createFilterItem(
        "countryFocus",
        "countryFocus",
        placeNames(params.selectedCountryFocus!),
        t ? t("filterLabelCountryFocus") : "Country focus",
        { countryCodes }
      )
    );
  }
  if (geoItems.length > 0) {
    sections.push(createSection("geographic", geoItems, t));
  }

  // Content section (language is shown separately in history cards)
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
  if (params.workTypes?.length) {
    contentItems.push(
      createFilterItem(
        "workType",
        "workType",
        namesOf(params.workTypes, WORK_TYPES),
        t ? t("publicationType") : "Publication type"
      )
    );
  }
  if (params.researchAreas?.length) {
    contentItems.push(
      createFilterItem(
        "researchArea",
        "researchArea",
        params.researchAreas.map((id) => names.researchAreas?.[id] ?? id).join(", "),
        t ? t("researchAreas") : "Research areas"
      )
    );
  }
  if (params.sdgs?.length) {
    contentItems.push(
      createFilterItem("sdg", "sdg", namesOf(params.sdgs, SDGS), t ? t("sdgs") : "SDGs")
    );
  }
  if (params.workLanguages?.length) {
    contentItems.push(
      createFilterItem(
        "workLanguage",
        "workLanguage",
        params.workLanguages.map((code) => names.language?.(code) ?? code).join(", "),
        t ? t("writtenIn") : "Written in"
      )
    );
  }
  if (params.institutionTypes?.length) {
    contentItems.push(
      createFilterItem(
        "institutionType",
        "institutionType",
        namesOf(params.institutionTypes, INSTITUTION_TYPES),
        t ? t("institutionType") : "Institution type"
      )
    );
  }
  if (params.funders?.length) {
    contentItems.push(
      createFilterItem(
        "funder",
        "funder",
        params.funders.map((id) => names.funders?.[id] ?? id).join(", "),
        t ? t("funders") : "Funders"
      )
    );
  }
  if (params.authors?.length) {
    contentItems.push(
      createFilterItem(
        "author",
        "author",
        params.authors.map((id) => names.authors?.[id] ?? id).join(", "),
        t ? t("authors") : "Authors"
      )
    );
  }
  if (params.minCitations) {
    const label = t ? t("atLeastCitations", { count: params.minCitations }) : `At least ${params.minCitations} citations`;
    contentItems.push(createFilterItem("minCitations", "minCitations", label, label));
  }
  if (params.openAccessOnly) {
    const label = t ? t("onlyOpenAccess") : "Only open access";
    contentItems.push(createFilterItem("openAccess", "openAccess", label, label));
  }
  if (params.hasAbstract) {
    const label = t ? t("onlyWithAbstract") : "Only with an abstract";
    contentItems.push(createFilterItem("hasAbstract", "hasAbstract", label, label));
  }
  if (params.includeRetracted) {
    const label = t ? t("includesRetracted") : "Includes retracted works";
    contentItems.push(createFilterItem("includeRetracted", "includeRetracted", label, label));
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
  formatDateTime?: FormatDateTimeFn,
  names?: FilterNames
): FilterItem[] {
  const sections = buildFilterData(params, t, formatDateTime, names);
  return sections.flatMap((section) => section.items);
}
