/**
 * Batch processor factory - Single source of truth for batch AI operations.
 * 
 * This factory creates processors that handle the common pattern of:
 * 1. Iterating over items (papers)
 * 2. Calling an AI operation for each
 * 3. Collecting results with fail-soft behavior (Promise.allSettled)
 * 4. Returning unified results/errors structure
 * 
 * Used by both client-side executor and server-side actions to eliminate duplication.
 */

import type { LanguageModel } from 'ai'
import type { BatchPaper, BatchError } from './batch-types'
import type { Usage } from './types'
import { executeAIOperation } from './execute'
import type { OperationConfig } from './configs'

// ═══════════════════════════════════════════════════════════════
// BATCH PROCESSOR TYPES
// ═══════════════════════════════════════════════════════════════

export interface BatchProcessorConfig<TItem, TConfigInput, TOutput, TResult> {
  /** The AI model to use */
  model: LanguageModel
  /** Function to transform item to config input */
  toConfigInput: (item: TItem) => TConfigInput
  /** Function to create operation config from config input */
  getOperationConfig: (input: TConfigInput) => OperationConfig<TConfigInput, TOutput>
  /** Function to transform AI output to result data */
  formatResult: (output: TOutput, item: TItem) => TResult
  /** Function to extract item ID for result mapping */
  getItemId: (item: TItem) => string
}

export interface BatchProcessorResult<TResult> {
  results: Record<string, TResult>
  errors: BatchError[]
  usages: Usage[]
}

// ═══════════════════════════════════════════════════════════════
// BATCH PROCESSOR FACTORY
// ═══════════════════════════════════════════════════════════════

/**
 * Process a batch of items through an AI operation.
 * Uses Promise.allSettled for fail-soft behavior - partial results on errors.
 */
export async function processBatch<TItem, TConfigInput, TOutput, TResult>(
  items: TItem[],
  config: BatchProcessorConfig<TItem, TConfigInput, TOutput, TResult>
): Promise<BatchProcessorResult<TResult>> {
  const { model, toConfigInput, getOperationConfig, formatResult, getItemId } = config
  
  const results: Record<string, TResult> = {}
  const errors: BatchError[] = []
  const usages: Usage[] = []

  // Process all items in parallel
  const promises = items.map(async (item) => {
    const configInput = toConfigInput(item)
    const operationConfig = getOperationConfig(configInput)
    
    const { output, usage } = await executeAIOperation({
      model,
      ...operationConfig,
    })

    return {
      itemId: getItemId(item),
      result: formatResult(output, item),
      usage,
    }
  })

  const settledResults = await Promise.allSettled(promises)

  for (let i = 0; i < settledResults.length; i++) {
    const settled = settledResults[i]
    
    if (settled.status === 'fulfilled') {
      const { itemId, result, usage } = settled.value
      results[itemId] = result
      usages.push(usage)
    } else {
      const itemId = getItemId(items[i]) || 'unknown'
      const errorMessage = settled.reason instanceof Error
        ? settled.reason.message
        : String(settled.reason)
      errors.push({ paperId: itemId, error: errorMessage })
    }
  }

  return { results, errors, usages }
}

// ═══════════════════════════════════════════════════════════════
// SCREENING BATCH PROCESSOR
// ═══════════════════════════════════════════════════════════════

import { getScreeningResponsesConfig } from './configs'
import type { ScreeningResultData } from './batch-types'
import type { GenerateScreeningResponsesInput } from './types'

export interface ScreeningBatchConfig {
  model: LanguageModel
  papers: BatchPaper[]
  questions: string[]
}

export async function processScreeningBatch(
  config: ScreeningBatchConfig
): Promise<BatchProcessorResult<ScreeningResultData>> {
  const { model, papers, questions } = config

  return processBatch<
    BatchPaper,
    GenerateScreeningResponsesInput,
    { responses: Record<string, boolean | null>; confidence: number },
    ScreeningResultData
  >(
    papers,
    {
      model,
      toConfigInput: (paper) => ({
        title: paper.title,
        abstract: paper.abstract,
        questions,
      }),
      getOperationConfig: getScreeningResponsesConfig,
      formatResult: (output) => ({
        responses: output.responses as Record<string, boolean | null>,
        confidence: output.confidence,
      }),
      getItemId: (paper) => paper.id,
    }
  )
}

// ═══════════════════════════════════════════════════════════════
// TRANSLATION BATCH PROCESSOR
// ═══════════════════════════════════════════════════════════════

import { getTranslatePaperContentConfig } from './configs'
import type { TranslationResultData, ExtractionItem, ExtractionResultData } from './batch-types'
import type { TranslatePaperContentInput, ExtractDataInput } from './types'

export interface TranslationBatchConfig {
  model: LanguageModel
  papers: BatchPaper[]
  sourceLanguage: string
}

export async function processTranslationBatch(
  config: TranslationBatchConfig
): Promise<BatchProcessorResult<TranslationResultData>> {
  const { model, papers, sourceLanguage } = config

  return processBatch<
    BatchPaper,
    TranslatePaperContentInput,
    { translatedTitle: string; translatedAbstract: string },
    TranslationResultData
  >(
    papers,
    {
      model,
      toConfigInput: (paper) => ({
        title: paper.title,
        abstract: paper.abstract,
        sourceLanguage,
      }),
      getOperationConfig: getTranslatePaperContentConfig,
      formatResult: (output) => ({
        translatedTitle: output.translatedTitle,
        translatedAbstract: output.translatedAbstract,
        sourceLanguage,
        isAlreadyInEnglish: false,
      }),
      getItemId: (paper) => paper.id,
    }
  )
}

// ═══════════════════════════════════════════════════════════════
// EXTRACTION BATCH PROCESSOR
// ═══════════════════════════════════════════════════════════════

import { getExtractDataConfig } from './configs'

export interface ExtractionBatchConfig {
  model: LanguageModel
  items: ExtractionItem[]
}

export async function processExtractionBatch(
  config: ExtractionBatchConfig
): Promise<BatchProcessorResult<ExtractionResultData & { resultId: string }>> {
  const { model, items } = config

  return processBatch<
    ExtractionItem,
    ExtractDataInput,
    { value: string | number | boolean | null; confidence: number; reasoning: string; sources?: Array<{ quote: string; location: string }> },
    ExtractionResultData & { resultId: string }
  >(
    items,
    {
      model,
      toConfigInput: (item) => ({
        title: item.title,
        abstract: item.abstract,
        question: item.question,
        type: item.type,
        ragContext: item.ragContext,
        ragChunks: item.ragChunks,
      }),
      getOperationConfig: getExtractDataConfig,
      formatResult: (output, item) => ({
        value: output.value,
        confidence: output.confidence,
        reasoning: output.reasoning,
        sources: output.sources ? parseSourceLocations(output.sources) : undefined,
        resultId: item.resultId,
      }),
      getItemId: (item) => item.resultId,
    }
  )
}

/**
 * Parse source locations from LLM response.
 * Converts "[SOURCE: pdf, page 3, chars 1200-1500]" markers to structured data.
 */
function parseSourceLocations(sources: Array<{ quote: string; location: string }>): ExtractionResultData['sources'] {
  return sources.map((source) => {
    const location = source.location
    
    // Match: "abstract, chars 0-450" or "abstract, chars 0-450"
    const abstractMatch = location.match(/abstract,?\s*chars?\s*(\d+)-(\d+)/i)
    if (abstractMatch) {
      return {
        quote: source.quote,
        sourceType: 'abstract' as const,
        pageNumber: undefined,
        startChar: parseInt(abstractMatch[1], 10),
        endChar: parseInt(abstractMatch[2], 10),
      }
    }
    
    // Match: "pdf, page 3, chars 5201-6800"
    const pdfMatch = location.match(/pdf,?\s*page\s*(\d+|\?),?\s*chars?\s*(\d+)-(\d+)/i)
    if (pdfMatch) {
      return {
        quote: source.quote,
        sourceType: 'pdf' as const,
        pageNumber: pdfMatch[1] !== '?' ? parseInt(pdfMatch[1], 10) : undefined,
        startChar: parseInt(pdfMatch[2], 10),
        endChar: parseInt(pdfMatch[3], 10),
      }
    }
    
    // Fallback: treat as abstract with no position
    return {
      quote: source.quote,
      sourceType: 'abstract' as const,
      pageNumber: undefined,
      startChar: 0,
      endChar: source.quote.length,
    }
  })
}
