/**
 * Types Index
 * Central export point for all application types
 */

// AI Types
export type { AIProvider, AIKeyMode } from './ai.types';

// Screening Types
export type {
  ScreeningQuestionType,
  ScreeningQuestion,
  ScreeningQuestionEntry,
  DataExtractionQuestion,
  ScreeningDocument,
  ScreeningResult,
  ScreeningResponses,
} from './screening.types';

// Search Types
export type {
  PaperResult,
  SearchField,
  DownloadHandlers,
  YearRangePreset,
  QueryHistoryEntry,
  QuestionHistoryEntry,
  SearchFilters,
  SearchResult,
  ViewMode,
  HistorySortBy,
  BookmarkSortBy,
  ExtractionSortBy,
  BookmarkData,
} from './search.types';

export { SEARCH_FIELDS } from './search.types';

// Extraction Types
export type {
  ExtractionQuestionType,
  ExtractionQuestion,
  ExtractionSourceType,
  ExtractionJob,
  ExtractionJobStatus,
  ExtractionPaper,
  ExtractionPaperStatus,
  ExtractionResult,
  ExtractionJobDetails,
} from './extraction.types';
