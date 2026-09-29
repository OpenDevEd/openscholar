import { getProviderModel } from '../server/providers'
import {
  executeAIOperation,
  AIApiKeyRequiredError,
  processScreeningBatch,
  processTranslationBatch,
} from '../core'
import {
  getEnhanceQueryConfig,
  getScreeningQuestionsConfig,
  getExtractionQuestionsConfig,
  getTranslateQueryConfig,
  getTranslatePaperContentConfig,
  getScreeningResponsesConfig,
  type OperationConfig
} from '../core/configs'
import { toExtractionQuestions } from '../core/schemas'
import type { Effort } from '../core/call-options'
import type { AIProvider } from '@/lib/types'
import { captureAIGeneration, captureAIGenerationBatch } from '@/lib/posthog-ai'
import {
  truncateForTracking,
  extractHttpStatus,
  extractErrorCode,
  type AITrackingEntry,
} from '@/lib/posthog-ai-shared'
import type {
  EnhanceSearchQueryInput,
  GenerateScreeningQuestionsInput,
  GenerateExtractionQuestionsInput,
  TranslateQueryInput,
  TranslatePaperContentInput,
  GenerateScreeningResponsesInput,
} from '../core/types'
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

export function createClientExecutor<TParams, TOutput, TResult>(
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
    const prompts = operationConfig.buildPrompts(operationConfig.input, 0)
    const inputForTracking = truncateForTracking(
      `[system] ${prompts.system}\n[user] ${prompts.prompt}`
    )

    const start = performance.now()
    try {
      const { output, usage } = await executeAIOperation({
        model,
        effort: config.effort,
        ...operationConfig,
      })
      const latencyMs = performance.now() - start
      const outputForTracking = truncateForTracking(JSON.stringify(output))

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
          input: inputForTracking,
          output: outputForTracking,
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
          input: inputForTracking,
          output: '',
          isError: true,
          errorMessage: error instanceof Error ? error.message : String(error),
          httpStatus: extractHttpStatus(error),
          errorCode: extractErrorCode(error),
          temperature: operationConfig.temperature,
        })
      } catch {
        // Fire-and-forget
      }
      throw error
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

export const translatePaperContent = createClientExecutor(
  getTranslatePaperContentConfig,
  (output) => ({
    translatedTitle: output.translatedTitle,
    translatedAbstract: output.translatedAbstract,
    noTranslationNeeded: false,
  }),
  'translate_paper_content'
)

export const generateScreeningResponses = createClientExecutor(
  getScreeningResponsesConfig,
  (output) => ({
    responses: output.responses as Record<string, boolean | null>,
    confidence: output.confidence,
  }),
  'generate_screening_responses'
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
          input: truncateForTracking(tracking.input),
          output: truncateForTracking(tracking.output),
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
        input: `Batch screening: ${papers.length} papers, ${questions.length} questions`,
        output: '',
        isError: true,
        errorMessage: error instanceof Error ? error.message : String(error),
        httpStatus: extractHttpStatus(error),
        errorCode: extractErrorCode(error),
      })
    } catch { /* fire-and-forget */ }
    throw error
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
          input: truncateForTracking(tracking.input),
          output: truncateForTracking(tracking.output),
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
        input: `Batch translation: ${papers.length} papers -> ${targetLanguage ?? 'auto'}`,
        output: '',
        isError: true,
        errorMessage: error instanceof Error ? error.message : String(error),
        httpStatus: extractHttpStatus(error),
        errorCode: extractErrorCode(error),
      })
    } catch { /* fire-and-forget */ }
    throw error
  }
}
