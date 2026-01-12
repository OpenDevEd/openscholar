/**
 * Screening Types
 * Single source of truth for screening-related type definitions
 */

import type { AIProvider } from './ai.types';

/**
 * Types of answers a screening question can accept
 */
export type ScreeningQuestionType = 'boolean' | 'number' | 'array' | 'string';

/**
 * A screening question with full metadata
 * Used in the screening store and systematic review workflow
 */
export interface ScreeningQuestion {
  id: string;
  key: string;
  type: ScreeningQuestionType;
  question: string;
}

/**
 * A simplified screening question entry for search history
 * @deprecated Use ScreeningQuestion instead when possible
 */
export interface ScreeningQuestionEntry {
  question: string;
  locked: boolean;
}

/**
 * Data extraction question (same structure as screening question)
 */
export interface DataExtractionQuestion {
  id: string;
  key: string;
  type: ScreeningQuestionType;
  question: string;
}

/**
 * A document to be screened
 */
export interface ScreeningDocument {
  id: string;
  title: string;
  publication_year?: number;
  abstract?: string;
  doi?: string;
  authorships?: Array<{
    author: {
      display_name: string;
    };
  }>;
  open_access?: {
    is_oa: boolean;
    oa_url?: string;
  };
  /** Zotero group id if imported from Zotero */
  zotero_group_id?: string;
  /** Direct link to open document in Zotero app */
  zotero_uri?: string;
  primary_location?: {
    source?: {
      display_name: string;
    };
  };
  cited_by_count?: number;
  referenced_works_count?: number;
  addedAt: string;
  /** Store the original OpenAlex work data */
  originalWork?: Record<string, unknown>;
  /** Source of import, e.g., 'zotero' */
  source?: string;
}

/**
 * Result of screening a single document
 */
export interface ScreeningResult {
  documentId: string;
  answers: Record<string, unknown>; // key -> answer value
  completedAt?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  pdfStatus?: 'used' | 'metadata' | 'error';
  pdfErrorMessage?: string;
  aiMetadata?: {
    reasoning: string;
    confidence: number;
    flags: string[];
    provider: string;
    model: string;
    processedAt: string;
  };
  cost?: number; // USD cost for this screening
}

/**
 * Screening responses for papers in search history
 * Key: PaperID, Value: Record of Question -> boolean | null
 */
export type ScreeningResponses = Record<string, Record<string, boolean | null>>;

/**
 * Factory function to create a screening question
 */
export function createScreeningQuestion(
  question: string,
  type: ScreeningQuestionType = 'boolean'
): ScreeningQuestion {
  return {
    id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    key: question.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_'),
    type,
    question: question.trim()
  };
}

/**
 * Factory function to create a data extraction question
 */
export function createDataExtractionQuestion(
  question: string,
  type: ScreeningQuestionType = 'boolean'
): DataExtractionQuestion {
  return {
    id: `deq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    key: question.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_'),
    type,
    question: question.trim()
  };
}

/**
 * Validate a screening question
 */
export function validateScreeningQuestion(question: ScreeningQuestion): boolean {
  return !!(
    question.id &&
    question.key &&
    question.question &&
    ['boolean', 'string', 'number', 'array'].includes(question.type)
  );
}

/**
 * Validate a data extraction question
 */
export function validateDataExtractionQuestion(question: DataExtractionQuestion): boolean {
  return !!(
    question.id &&
    question.key &&
    question.question &&
    ['boolean', 'string', 'number', 'array'].includes(question.type)
  );
}
