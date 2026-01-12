/**
 * Types Index
 * Central export point for all application types
 */

// AI Types
export type { AIProvider, AIModelConfig, AIUsage, AIResponseMetadata } from './ai.types';

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

export {
  createScreeningQuestion,
  createDataExtractionQuestion,
  validateScreeningQuestion,
  validateDataExtractionQuestion,
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
} from './search.types';

export { SEARCH_FIELDS } from './search.types';

// Common Types
export type {
  ReviewStatus,
  ReviewStep,
  SearchTerm,
  SearchTermData,
} from './common.types';

export {
  isSearchTermObject,
  isSearchTermString,
  normalizeSearchTerms,
  createSearchTerm,
  validateSearchTerm,
} from './common.types';
