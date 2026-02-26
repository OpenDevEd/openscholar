/**
 * Shared batch processing types used by both client-side executor and server-side actions.
 * This eliminates duplication between the two execution modes:
 * - Client executor: Used when routing resolves to BYOK/local execution.
 * - Server action: Used when routing resolves to credits execution.
 */

// ═══════════════════════════════════════════════════════════════
// COMMON BATCH TYPES
// ═══════════════════════════════════════════════════════════════

export interface BatchPaper {
  id: string
  title: string
  abstract: string
}

export interface BatchError {
  paperId: string
  error: string
}

export interface BatchResult<TData> {
  results: Record<string, TData>
  errors: BatchError[]
}

// ═══════════════════════════════════════════════════════════════
// SCREENING BATCH TYPES
// ═══════════════════════════════════════════════════════════════

export interface BatchScreeningParams {
  papers: BatchPaper[]
  questions: string[]
}

export interface ScreeningResultData {
  responses: Record<string, boolean | null>
  confidence: number
}

export type BatchScreeningResult = BatchResult<ScreeningResultData>

// ═══════════════════════════════════════════════════════════════
// TRANSLATION BATCH TYPES
// ═══════════════════════════════════════════════════════════════

export interface BatchTranslationParams {
  papers: BatchPaper[]
  targetLanguage?: string
}

export interface TranslationResultData {
  translatedTitle: string
  translatedAbstract: string
  noTranslationNeeded: boolean
}

export type BatchTranslationResult = BatchResult<TranslationResultData>

// Extraction batch types removed
