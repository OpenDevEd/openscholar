import { Work } from "@sickrin/openalex-sdk/dist/src/types/work";
import { DateRange } from 'react-day-picker';

export type PaperResult = Work;

export interface DownloadHandlers {
  onDownloadItem: (item: PaperResult, format: 'json' | 'csv') => void;
  onDownloadEssentialItem: (item: PaperResult, format: 'json' | 'csv') => void;
}

export interface YearRangePreset {
  label: string;
  range: [number, number];
}

export type SearchField = 'title_and_abstract' | 'title' | 'abstract' | 'fulltext' | 'display_name';

/**
 * Unified interface for all search filters
 * All filters have equal importance and are included in every function signature
 */
export interface SearchFilters {
  // Basic search parameters
  searchField: SearchField;
  sortBy: string;
  
  // Date/time filters
  dateRange?: DateRange;
  yearRange?: [number, number];
  filterType: "date" | "year";
  isYearRangeEnabled?: boolean; // Toggle to enable/disable year range filter
  
  // Rating filters
  ratingRange?: [number, number];
  onlyRatedPapers?: boolean;
  
  // Geographic filters
  selectedRegions: string[];
  selectedCountryFocus: string[];
  
  // Reference filters
  citesItemId: string;
  citedByItemId: string;
  relatedToItemId: string;
  
  // Content type filters
  reviewFilter: boolean;
} 

/**
 * Represents a single query entry in the search history
 */
export interface QueryHistoryEntry {
  query: string;
  timestamp: string; // ISO timestamp when this query was made
}

/**
 * Represents a single question entry in the search history
 */
export interface QuestionHistoryEntry {
  question: string;
  timestamp: string; // ISO timestamp when this question was asked
}