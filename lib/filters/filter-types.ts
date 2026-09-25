/**
 * Filter Types
 * Shared type definitions for the filter display system
 */

import { LucideIcon } from "lucide-react";
import { SearchField } from "@/lib/types/search.types";
import { DateRange } from "react-day-picker";

/**
 * All possible filter types
 */
export type FilterType =
  | "field"
  | "sort"
  | "year"
  | "date"
  | "regions"
  | "countryFocus"
  | "language"
  | "review"
  | "rating"
  | "onlyRated"
  | "cites"
  | "citedBy"
  | "relatedTo"
  | "workType"
  | "researchArea"
  | "sdg"
  | "openAccess"
  | "workLanguage"
  | "institutionType"
  | "funder"
  | "minCitations"
  | "hasAbstract"
  | "includeRetracted";

/**
 * Section categories for grouping filters
 */
export type FilterSectionType =
  | "search"
  | "time"
  | "geographic"
  | "content"
  | "ratings"
  | "citations";

/**
 * A single filter item with all display data
 */
export interface FilterItem {
  /** Unique key for React rendering */
  key: string;
  /** The type of filter */
  type: FilterType;
  /** Lucide icon component, the same one the sidebar card uses */
  icon: LucideIcon;
  /** Human-readable label */
  label: string;
  /** Formatted display value */
  displayValue: string;
  /** Country codes for geographic filters (for flag display) */
  countryCodes?: string[];
  /** Rating range for star display */
  ratingRange?: [number, number];
}

/**
 * A section containing multiple filter items
 */
export interface FilterSection {
  /** Section identifier */
  id: FilterSectionType;
  /** Section title */
  title: string;
  /** Filter items in this section */
  items: FilterItem[];
}

/**
 * Input parameters for building filter data
 * Matches the shape used by search results and tooltip props
 */
export interface FilterParams {
  field?: SearchField;
  sortBy?: string;
  yearRange?: [number, number];
  dateRange?: DateRange;
  filterType?: "date" | "year";
  isYearRangeEnabled?: boolean;
  selectedRegions?: string[];
  selectedCountryFocus?: string[];
  language?: string;
  reviewFilter?: boolean;
  ratingRange?: [number, number];
  onlyRatedPapers?: boolean;
  citesItemId?: string;
  citedByItemId?: string;
  relatedToItemId?: string;
  researchAreas?: string[];
  sdgs?: string[];
  openAccessOnly?: boolean;
  workTypes?: string[];
  workLanguages?: string[];
  institutionTypes?: string[];
  funders?: string[];
  minCitations?: number | null;
  hasAbstract?: boolean;
  includeRetracted?: boolean;
}
