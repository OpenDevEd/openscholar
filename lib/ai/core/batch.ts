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
import type { Effort } from './call-options'
import type { OperationConfig } from './configs'
import { decideYesNo, isDecisionModel, paperState } from '../decisions'

// ═══════════════════════════════════════════════════════════════
// BATCH PROCESSOR TYPES
// ═══════════════════════════════════════════════════════════════

export interface BatchProcessorConfig<TItem, TConfigInput, TOutput, TResult> {
  /** The AI model to use */
  model: LanguageModel
  /** Its reasoning effort; none means the model's default */
  effort?: Effort
  /** Function to transform item to config input */
  toConfigInput: (item: TItem) => TConfigInput
  /** Function to create operation config from config input */
  getOperationConfig: (input: TConfigInput) => OperationConfig<TConfigInput, TOutput>
  /** Function to transform AI output to result data */
  formatResult: (output: TOutput, item: TItem) => TResult
  /** Function to extract item ID for result mapping */
  getItemId: (item: TItem) => string
  /** How a failed item is told; its message by default. */
  failure?: Failure
}

type Failure = (error: unknown) => Omit<BatchError, 'paperId'>
const messageOf: Failure = (error) => ({ error: error instanceof Error ? error.message : String(error) })

interface ItemTrackingData {
  latencyMs: number
  temperature: number
}

export interface BatchProcessorResult<TResult> {
  results: Record<string, TResult>
  errors: BatchError[]
  usages: Usage[]
  usageByItemId: Record<string, Usage>
  trackingByItemId: Record<string, ItemTrackingData>
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
  const { model, effort, toConfigInput, getOperationConfig, formatResult, getItemId, failure } = config

  return settleBatch(items, getItemId, failure, async (item) => {
    const operationConfig = getOperationConfig(toConfigInput(item))

    const start = Date.now()
    const { output, usage } = await executeAIOperation({
      model,
      effort,
      ...operationConfig,
    })
    return {
      result: formatResult(output, item),
      usage,
      tracking: {
        latencyMs: Date.now() - start,
        temperature: operationConfig.temperature,
      },
    }
  })
}

/** Runs every item in parallel and keeps what succeeded; a failed item becomes an error, not a failed batch. */
async function settleBatch<TItem, TResult>(
  items: TItem[],
  getItemId: (item: TItem) => string,
  failure: Failure = messageOf,
  run: (item: TItem) => Promise<{ result: TResult; usage: Usage; tracking: ItemTrackingData }>,
): Promise<BatchProcessorResult<TResult>> {
  const results: Record<string, TResult> = {}
  const errors: BatchError[] = []
  const usages: Usage[] = []
  const usageByItemId: Record<string, Usage> = {}
  const trackingByItemId: Record<string, ItemTrackingData> = {}

  const settledResults = await Promise.allSettled(items.map(run))
  settledResults.forEach((settled, i) => {
    const itemId = getItemId(items[i]!) || 'unknown'
    if (settled.status === 'fulfilled') {
      const { result, usage, tracking } = settled.value
      results[itemId] = result
      usages.push(usage)
      usageByItemId[itemId] = usage
      trackingByItemId[itemId] = tracking
    } else {
      errors.push({ paperId: itemId, ...failure(settled.reason) })
    }
  })

  return { results, errors, usages, usageByItemId, trackingByItemId }
}

// ═══════════════════════════════════════════════════════════════
// SCREENING BATCH PROCESSOR
// ═══════════════════════════════════════════════════════════════

import { getScreeningResponsesConfig } from './configs'
import type { ScreeningReadData, ScreeningResultData } from './batch-types'
import type { GenerateScreeningResponsesInput } from './types'

export interface ScreeningBatchConfig {
  model: LanguageModel
  papers: BatchPaper[]
  questions: string[]
  effort?: Effort
  /** The OpenRouter key a decision model (Jev) is called with. */
  decisionsKey?: string
  /** Groups a job's Jev calls in OpenRouter's logs. */
  sessionId?: string
  failure?: Failure
  /** Ask a text model, with each answer, for the sentence of the abstract it rests on. A decision model names none. */
  passages?: boolean
}

/** A paper's screening, keeping the confidence in each answer; the overall figure is their mean. */
function screeningResult(responses: Record<string, boolean | null>, confidences: Record<string, number>): ScreeningResultData {
  const values = Object.values(confidences)
  return { responses, confidences, confidence: values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1) }
}

export async function processScreeningBatch(
  config: ScreeningBatchConfig
): Promise<BatchProcessorResult<ScreeningReadData>> {
  const { model, effort, papers, questions, decisionsKey, sessionId, failure, passages } = config
  const modelSlug = typeof model === 'string' ? model : model.modelId

  // Jev answers every question about a paper in one decisions call.
  if (isDecisionModel(modelSlug)) {
    if (!decisionsKey) throw new Error('Jev needs an OpenRouter key')
    return settleBatch(papers, (paper) => paper.id, failure, async (paper) => {
      const start = Date.now()
      const state = paperState({ title: paper.title, abstract: paper.abstract || 'No abstract available' }, questions)
      const { answers, usage } = await decideYesNo({ apiKey: decisionsKey, model: modelSlug, state, questions, sessionId })
      const result = screeningResult(
        Object.fromEntries(questions.map((question, i) => [question, answers[i]!.answer])),
        Object.fromEntries(questions.map((question, i) => [question, answers[i]!.confidence])),
      )
      return {
        result,
        usage,
        tracking: { latencyMs: Date.now() - start, temperature: 0 },
      }
    })
  }

  return processBatch<
    BatchPaper,
    GenerateScreeningResponsesInput,
    { responses: Record<string, boolean | null>; confidences: Record<string, number>; passages?: Record<string, number | null> },
    ScreeningReadData
  >(
    papers,
    {
      model,
      effort,
      toConfigInput: (paper) => ({
        title: paper.title,
        abstract: paper.abstract,
        questions,
        ...(paper.file ? { file: paper.file } : {}),
        // A sentence number names a sentence of the abstract: a paper read as its PDF has none.
        ...(passages && !paper.file ? { passages } : {}),
      }),
      getOperationConfig: getScreeningResponsesConfig,
      formatResult: (output) => ({ ...screeningResult(output.responses, output.confidences), ...(output.passages ? { passages: output.passages } : {}) }),
      getItemId: (paper) => paper.id,
      failure,
    }
  )
}

// ═══════════════════════════════════════════════════════════════
// TRANSLATION BATCH PROCESSOR
// ═══════════════════════════════════════════════════════════════

import { getTranslatePaperContentConfig } from './configs'
import type { TranslationResultData } from './batch-types'
import type { TranslatePaperContentInput } from './types'

export interface TranslationBatchConfig {
  model: LanguageModel
  papers: BatchPaper[]
  targetLanguage?: string
  effort?: Effort
}

export async function processTranslationBatch(
  config: TranslationBatchConfig
): Promise<BatchProcessorResult<TranslationResultData>> {
  const { model, effort, papers, targetLanguage } = config

  return processBatch<
    BatchPaper,
    TranslatePaperContentInput,
    { translatedTitle: string; translatedAbstract: string },
    TranslationResultData
  >(
    papers,
    {
      model,
      effort,
      toConfigInput: (paper) => ({
        title: paper.title,
        abstract: paper.abstract,
        ...(targetLanguage && { targetLanguage }),
      }),
      getOperationConfig: getTranslatePaperContentConfig,
      formatResult: (output) => ({
        translatedTitle: output.translatedTitle,
        translatedAbstract: output.translatedAbstract,
        noTranslationNeeded: false,
      }),
      getItemId: (paper) => paper.id,
    }
  )
}

// Extraction batch processor removed
