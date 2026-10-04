/**
 * Search Types
 * Single source of truth for search-related type definitions
 */

import { Work } from "@sickrin/openalex-sdk/dist/src/types/work";
import { DateRange } from 'react-day-picker';
import type { ScreeningQuestionEntry, ScreeningResponses } from './screening.types';

/**
 * Paper result from OpenAlex
 * Extends SDK Work type with additional fields returned by the API
 * but not yet typed in the SDK. Uses Omit to override the SDK's
 * untyped sustainable_development_goals field with proper types.
 */
export type PaperResult = Omit<Work, 'sustainable_development_goals'> & {
  /** Field-weighted citation impact */
  fwci?: number;
  /** Number of referenced works (API returns this alongside referenced_works) */
  referenced_works_count?: number;
  /** Citation percentile for publication year */
  cited_by_percentile_year?: { min: number; max: number };
  /** Primary topic classification */
  primary_topic?: {
    id: string;
    display_name: string;
    score?: number;
    field?: { id: string; display_name: string };
    subfield?: { id: string; display_name: string };
    domain?: { id: string; display_name: string };
  };
  /** UN Sustainable Development Goals */
  sustainable_development_goals?: {
    id: string;
    display_name: string;
    score: number;
  }[];
};

/**
 * Search field options
 */
export type SearchField = 'title_and_abstract' | 'title' | 'abstract' | 'fulltext' | 'display_name' | 'oql';

/**
 * Available search fields with labels
 */
export const SEARCH_FIELDS = [
  { value: 'title_and_abstract', label: 'Title, abstract' },
  { value: 'title', label: 'Title' },
  { value: 'abstract', label: 'Abstract' },
  { value: 'fulltext', label: 'Fulltext' },
  { value: 'display_name', label: 'Display name' },
  { value: 'oql', label: 'OQL query' },
] as const;

/**
 * Download handlers interface
 */
export interface DownloadHandlers {
  onDownloadItem: (item: PaperResult, format: 'json' | 'csv') => void;
  onDownloadEssentialItem: (item: PaperResult, format: 'json' | 'csv') => void;
}

/**
 * Year range preset - key is used for i18n (searchFilters namespace), range is [from, to]
 */
export type YearPresetKey =
  | "yearPresetThisYear"
  | "yearPresetLastYear"
  | "yearPresetLast5Years"
  | "yearPresetLast10Years"
  | "yearPresetLast15Years"
  | "yearPresetLast20Years";

export interface YearRangePreset {
  key: YearPresetKey;
  range: [number, number];
  /** @deprecated Use key with translations instead */
  label?: string;
}

/**
 * Represents a single query entry in the search history
 */
export interface QueryHistoryEntry {
  query: string;
  timestamp: string; // ISO timestamp when this query was made
  /** Scope the query ran in. Entries from before scopes were saved are keyword queries. */
  field?: SearchField;
}

/**
 * Represents a single question entry in the search history
 */
export interface QuestionHistoryEntry {
  question: string;
  timestamp: string; // ISO timestamp when this question was asked
}

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
  filterType: 'date' | 'year';
  isYearRangeEnabled?: boolean;
  
  // Rating filters (client-side)
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
  researchAreas: string[];
  sdgs: string[];
  openAccessOnly: boolean;
  workTypes: string[];
  workLanguages: string[];
  institutionTypes: string[];
  funders: string[];
  authors: string[];
  minCitations: number | null;
  hasAbstract: boolean;
  /** Retracted works are left out unless this is set. */
  includeRetracted: boolean;
}

/**
 * A saved search result in history
 */
export interface SearchResult {
  id: string;
  importSource?: { id: string; query: string; resolvedQuery: string; resolution: "at_export" };
  query: string;
  /** How many queries the search has had, the current one included. */
  queryHistoryCount: number;
  questionCount: number;
  latestQuestion?: string;
  /** The search's past questions, one a line, newest kept up to QUESTION_TEXT_MAX; for filtering by them. */
  questionText: string;
  /**
   * The full history, held only by a signed-out visitor's searches in this browser. A
   * signed-in account's history is read a search at a time (lib/research/history.ts).
   */
  queryHistory?: QueryHistoryEntry[];
  questionHistory?: QuestionHistoryEntry[];
  screeningQuestions: ScreeningQuestionEntry[];
  screeningResponses: ScreeningResponses;
  count: number;
  field: SearchField;
  dateRange?: DateRange;
  yearRange?: [number, number];
  filterType?: 'date' | 'year';
  isYearRangeEnabled?: boolean;
  sortBy?: string;
  selectedRegions?: string[];
  selectedCountryFocus?: string[];
  ratingRange?: [number, number];
  onlyRatedPapers?: boolean;
  citesItemId?: string;
  citedByItemId?: string;
  relatedToItemId?: string;
  reviewFilter?: boolean;
  researchAreas?: string[];
  sdgs?: string[];
  openAccessOnly?: boolean;
  workTypes?: string[];
  workLanguages?: string[];
  institutionTypes?: string[];
  funders?: string[];
  authors?: string[];
  minCitations?: number;
  hasAbstract?: boolean;
  includeRetracted?: boolean;
  language?: string; // ISO 639-1 language code
  page?: number; // Last viewed page for this search
  chatJobIdsByAccountId?: Record<string, string>; // Per-account chat job links for this search
  createdAt: string;
  updatedAt: string;
}

/**
 * UI View Modes
 */
export type ViewMode = 'list-simple' | 'list-detail' | 'grid-2' | 'grid-3';

/**
 * Sort options for history
 */
export type HistorySortBy = 'recent' | 'oldest' | 'most' | 'least';

/**
 * Sort options for bookmarks
 */
export type BookmarkSortBy = 'recent' | 'oldest' | 'alpha' | 'alpha-desc';

/**
 * Sort options for extraction jobs
 */
export type ExtractionSortBy = 'recent' | 'oldest' | 'name' | 'status';

/**
 * Bookmark data structure
 */
export interface BookmarkData {
  expansion: string;
  createdAt: number;
}
