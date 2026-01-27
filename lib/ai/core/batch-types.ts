/**
 * Shared batch processing types used by both client-side executor and server-side actions.
 * This eliminates duplication between the two execution modes:
 * - Client executor: Used when apiKeyMode === 'local' (BYOK - user's own API key)
 * - Server action: Used when apiKeyMode === 'credits' (platform credits)
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
  sourceLanguage: string
}

export interface TranslationResultData {
  translatedTitle: string
  translatedAbstract: string
  sourceLanguage: string
  isAlreadyInEnglish: boolean
}

export type BatchTranslationResult = BatchResult<TranslationResultData>

// ═══════════════════════════════════════════════════════════════
// EXTRACTION BATCH TYPES
// ═══════════════════════════════════════════════════════════════

// RAG chunk with position info for citation tracking
export interface RagChunkWithPosition {
  text: string
  sourceType: 'abstract' | 'pdf'
  pageNumber?: number
  startChar: number
  endChar: number
}

// Source citation from extraction
export interface ExtractionSource {
  quote: string
  sourceType: 'abstract' | 'pdf'
  pageNumber?: number
  startChar: number
  endChar: number
}

export interface ExtractionItem {
  documentId: string
  resultId: string
  title: string
  abstract: string
  questionId: string
  question: string
  type: 'text' | 'number' | 'boolean'
  // RAG-enhanced context from full-text search (legacy)
  ragContext?: string
  // Position-tracked chunks for citation support
  ragChunks?: RagChunkWithPosition[]
}

export interface ExtractionResultData {
  value: string | number | boolean | null
  confidence: number
  reasoning: string
  sources?: ExtractionSource[]
}

export interface BatchExtractionParams {
  items: ExtractionItem[]
}

export type BatchExtractionResult = BatchResult<ExtractionResultData>
