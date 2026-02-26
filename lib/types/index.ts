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
  SearchUrlParams,
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
  ExtractionHistorySource,
  ExtractionZoteroItem,
  ExtractionZoteroSelection,
  ExtractionManualItem,
  ExtractionJob,
  ExtractionJobStatus,
  ExtractionPaper,
  ExtractionPaperStatus,
  ExtractionResult,
  ExtractionJobDetails,
  CreateExtractionJobInput,
  ExtractionSavedView,
  ExtractionWorkflowTemplate,
  ExtractionReportSnapshot,
  ExtractionRunDiff,
} from './extraction.types';
