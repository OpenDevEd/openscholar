import { APICallError, RetryError } from 'ai'
import { getProviderModel } from '../server/providers'
import { getProviderConfig } from '@/lib/ai-models'
import { DecisionsError } from '../decisions'
import {
  executeAIOperation,
  AIApiKeyRequiredError,
  AIKeyError,
  AIKeyUnreachableError,
  processScreeningBatch,
  processTranslationBatch,
} from '../core'
import {
  getEnhanceQueryConfig,
  getScreeningQuestionsConfig,
  getScreeningCriteriaConfig,
  getExtractionQuestionsConfig,
  getTranslateQueryConfig,
  type OperationConfig
} from '../core/configs'
import { toExtractionQuestions, toWrittenCriteria } from '../core/schemas'
import type { Effort } from '../core/call-options'
import type { AIProvider } from '@/lib/types'
import { captureAIGeneration, captureAIGenerationBatch } from '@/lib/posthog-ai'
import {
  extractHttpStatus,
  extractErrorCode,
  type AITrackingEntry,
} from '@/lib/posthog-ai-shared'
import type {
  BatchPaper,
  BatchScreeningResult,
  BatchTranslationResult,
} from '../core/batch-types'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  model: string
  effort?: Effort
}

/**
 * A failure on the person's own key as the provider put it: a refused call carries the
 * provider's message, and a call the browser couldn't make says so. Anything else passes through.
 */
function keyError(error: unknown, provider: AIProvider): unknown {
  const { name } = getProviderConfig(provider)
  for (let e: unknown = error; e instanceof Error; e = RetryError.isInstance(e) ? e.lastError : e.cause) {
    if (APICallError.isInstance(e)) return new AIKeyError(name, e.message, e)
    if (e instanceof DecisionsError) return new AIKeyError(name, e.detail, e)
    if (e instanceof TypeError) return new AIKeyUnreachableError(name, e)
  }
  return error
}

/** A paper that failed on the key: the provider's words when it answered, else as it came, which the screening alert classifies. */
const keyFailure = (provider: AIProvider) => (error: unknown) => {
  const told = keyError(error, provider)
  return told instanceof AIKeyError ? { error: told.message, onKey: true } : { error: error instanceof Error ? error.message : String(error) }
}

function createClientExecutor<TParams, TOutput, TResult>(
  configFactory: (params: TParams) => OperationConfig<TParams, TOutput>,
  formatOutput: (output: TOutput, params: TParams) => TResult,
  feature: string
) {
  return async (params: TParams, config: AIConfig) => {
    if (!config.apiKey) {
      throw new AIApiKeyRequiredError()
    }
    const model = await getProviderModel(config.provider, config.apiKey, config.model)
    const operationConfig = configFactory(params)

    const start = performance.now()
    try {
      const { output, usage } = await executeAIOperation({
        model,
        effort: config.effort,
        ...operationConfig,
      })
      const latencyMs = performance.now() - start

      // Tracking is fire-and-forget: never let a PostHog failure crash a
      // successful AI operation (e.g., consent denied, SDK not initialized).
      try {
        captureAIGeneration({
          provider: config.provider,
          modelId: config.model,
          feature,
          usage: {
            inputTokens: usage.inputTokens ?? usage.promptTokens,
            outputTokens: usage.outputTokens ?? usage.completionTokens,
          },
          latencyMs,
          temperature: operationConfig.temperature,
        })
      } catch {
        // Fire-and-forget — tracking must never block the happy path
      }

      return formatOutput(output, params)
    } catch (error) {
      const latencyMs = performance.now() - start
      try {
        captureAIGeneration({
          provider: config.provider,
          modelId: config.model,
          feature,
          usage: { inputTokens: 0, outputTokens: 0 },
          latencyMs,
          isError: true,
          httpStatus: extractHttpStatus(error),
          errorCode: extractErrorCode(error),
          temperature: operationConfig.temperature,
        })
      } catch {
        // Fire-and-forget
      }
      throw keyError(error, config.provider)
    }
  }
}

export const enhanceSearchQuery = createClientExecutor(
  getEnhanceQueryConfig,
  (output) => ({
    enhancedQuery: output.enhancedQuery,
    explanation: '',
  }),
  'enhance_search_query'
)

export const generateScreeningQuestions = createClientExecutor(
  getScreeningQuestionsConfig,
  (output) => ({
    questions: output.questions,
  }),
  'generate_screening_questions'
)

export const generateScreeningCriteria = createClientExecutor(
  getScreeningCriteriaConfig,
  (output) => toWrittenCriteria(output.criteria),
  'generate_screening_questions'
)

export const generateExtractionQuestions = createClientExecutor(
  getExtractionQuestionsConfig,
  toExtractionQuestions,
  'generate_extraction_questions'
)

export const translateQuery = createClientExecutor(
  getTranslateQueryConfig,
  (output) => ({
    translatedQuery: output.translatedQuery,
  }),
  'translate_query'
)

// ═══════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════

export interface BatchScreeningParams {
  papers: BatchPaper[]
  questions: string[]
}

export async function generateBatchScreeningResponses(
  params: BatchScreeningParams,
  config: AIConfig
): Promise<BatchScreeningResult> {
  const { papers, questions } = params

  if (papers.length === 0 || questions.length === 0) {
    return { results: {}, errors: [] }
  }

  if (!config.apiKey) {
    throw new AIApiKeyRequiredError()
  }

  const model = await getProviderModel(config.provider, config.apiKey, config.model)
  const start = performance.now()

  try {
    const { results, errors, usageByItemId, trackingByItemId } = await processScreeningBatch({
      model,
      effort: config.effort,
      papers,
      questions,
      ...(config.provider === 'openrouter' && { decisionsKey: config.apiKey }),
      failure: keyFailure(config.provider),
    })

    const entries: AITrackingEntry[] = Object.entries(trackingByItemId).map(
      ([itemId, tracking]) => {
        const usage = usageByItemId[itemId]
        return {
          feature: 'batch_screening_responses',
          usage: {
            inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
            outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
          },
          latencyMs: tracking.latencyMs,
          temperature: tracking.temperature,
        }
      }
    )

    try { captureAIGenerationBatch(config.provider, config.model, entries) } catch { /* fire-and-forget */ }

    return { results, errors }
  } catch (error) {
    const latencyMs = performance.now() - start
    try {
      captureAIGeneration({
        provider: config.provider,
        modelId: config.model,
        feature: 'batch_screening_responses',
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs,
        isError: true,
        httpStatus: extractHttpStatus(error),
        errorCode: extractErrorCode(error),
      })
    } catch { /* fire-and-forget */ }
    throw keyError(error, config.provider)
  }
}

export interface BatchTranslationParams {
  papers: BatchPaper[]
  targetLanguage?: string
}

export async function generateBatchTranslations(
  params: BatchTranslationParams,
  config: AIConfig
): Promise<BatchTranslationResult> {
  const { papers, targetLanguage } = params

  if (papers.length === 0) {
    return { results: {}, errors: [] }
  }

  if (!config.apiKey) {
    throw new AIApiKeyRequiredError()
  }

  const model = await getProviderModel(config.provider, config.apiKey, config.model)
  const start = performance.now()

  try {
    const { results, errors, usageByItemId, trackingByItemId } = await processTranslationBatch({
      model,
      effort: config.effort,
      papers,
      targetLanguage,
    })

    const entries: AITrackingEntry[] = Object.entries(trackingByItemId).map(
      ([itemId, tracking]) => {
        const usage = usageByItemId[itemId]
        return {
          feature: 'batch_translations',
          usage: {
            inputTokens: usage?.inputTokens ?? usage?.promptTokens ?? 0,
            outputTokens: usage?.outputTokens ?? usage?.completionTokens ?? 0,
          },
          latencyMs: tracking.latencyMs,
          temperature: tracking.temperature,
        }
      }
    )

    try { captureAIGenerationBatch(config.provider, config.model, entries) } catch { /* fire-and-forget */ }

    return { results, errors }
  } catch (error) {
    const latencyMs = performance.now() - start
    try {
      captureAIGeneration({
        provider: config.provider,
        modelId: config.model,
        feature: 'batch_translations',
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs,
        isError: true,
        httpStatus: extractHttpStatus(error),
        errorCode: extractErrorCode(error),
      })
    } catch { /* fire-and-forget */ }
    throw keyError(error, config.provider)
  }
}
