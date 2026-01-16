/**
 * Filters Module
 * Re-exports all filter-related utilities
 */

// Types
export type {
  FilterType,
  FilterSectionType,
  FilterItem,
  FilterSection,
  FilterParams,
} from "./filter-types";

// Configuration
export {
  SECTION_CONFIG,
  FILTER_ICONS,
  FILTER_EMOJIS,
  SORT_OPTIONS,
  SIDEBAR_BADGE_COLORS,
  HISTORY_BADGE_COLORS,
} from "./filter-config";

// Builder functions
export {
  buildFilterData,
  countActiveFilters,
  getAllFilterItems,
  getFieldLabel,
  getSortLabel,
  extractCountryCodes,
  countRegions,
  formatGeoSummary,
  formatRatingRange,
  formatRatingSummary,
  hasActiveFiltersFromResult,
} from "./filter-builder";
