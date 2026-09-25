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
export { SECTION_TITLES, FILTER_ICONS, SORT_OPTIONS } from "./filter-config";

// Builder functions
export type { FilterT, FormatDateTimeFn, FilterNames } from "./filter-builder";
export {
  buildFilterData,
  countActiveFilters,
  getAllFilterItems,
  getFieldLabel,
  getSortLabel,
  extractCountryCodes,
  formatRatingRange,
  hasActiveFiltersFromResult,
} from "./filter-builder";
