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
  /** It failed on the person's own key, and `error` is the provider's own words. */
  onKey?: boolean
}

interface BatchResult<TData> {
  results: Record<string, TData>
  errors: BatchError[]
}

export interface ScreeningResultData {
  responses: Record<string, boolean | null>
  /** The model's confidence in each response, by question (0-1). */
  confidences: Record<string, number>
  /** The mean of `confidences`. */
  confidence: number
}

/** A screening that also names, for each response, the sentence of the abstract it relied on, counted from 0: asked for by a screening with reviewers (convex/screening/reading.ts), and null where the model named none. */
export interface ScreeningReadData extends ScreeningResultData {
  passages?: Record<string, number | null>
}

export type BatchScreeningResult = BatchResult<ScreeningResultData>

export interface TranslationResultData {
  translatedTitle: string
  translatedAbstract: string
  noTranslationNeeded: boolean
}

export type BatchTranslationResult = BatchResult<TranslationResultData>

// Extraction batch types removed
