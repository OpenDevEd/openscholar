// ============================================================================
// REPOSITORY TYPES AND UTILITIES
// ============================================================================

// Import types from centralized location
import type { 
  ScreeningQuestion, 
  DataExtractionQuestion,
  ScreeningQuestionType,
} from './types';

// Import utility functions from centralized location
import {
  createScreeningQuestion as _createScreeningQuestion,
  createDataExtractionQuestion as _createDataExtractionQuestion,
  validateScreeningQuestion as _validateScreeningQuestion,
  validateDataExtractionQuestion as _validateDataExtractionQuestion,
} from './types';

// Re-export types for backwards compatibility
export type { 
  ScreeningQuestion, 
  DataExtractionQuestion,
};

// Re-export utility functions from centralized types
export const validateScreeningQuestion = _validateScreeningQuestion;
export const validateDataExtractionQuestion = _validateDataExtractionQuestion;

// These have slightly different signatures in repo.ts, keep local versions
export function createScreeningQuestion(
  question: string,
  type: ScreeningQuestionType = 'boolean'
): ScreeningQuestion {
  return _createScreeningQuestion(question, type);
}

export function createDataExtractionQuestion(
  question: string,
  type: ScreeningQuestionType = 'boolean'
): DataExtractionQuestion {
  return _createDataExtractionQuestion(question, type);
}
