import { getProviderModel } from './providers'
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
import type { AIProvider } from '@/lib/types'
import { captureAIGeneration } from '@/lib/posthog-ai'

const MAX_TRACKING_CONTENT_LENGTH = 2000

function truncateForTracking(s: string): string {
  if (s.length <= MAX_TRACKING_CONTENT_LENGTH) return s
  return s.slice(0, MAX_TRACKING_CONTENT_LENGTH) + '...[truncated]'
}
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
        ...operationConfig,
      })
      const latencyMs = performance.now() - start
      const outputForTracking = truncateForTracking(JSON.stringify(output))

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
      })

      return formatOutput(output, params)
    } catch (error) {
      const latencyMs = performance.now() - start
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
      })
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
  (output) => ({ questions: output.questions }),
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
  (output, params) => ({
    translatedTitle: output.translatedTitle,
    translatedAbstract: output.translatedAbstract,
    sourceLanguage: params.sourceLanguage,
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
    const { results, errors, usages } = await processScreeningBatch({
      model,
      papers,
      questions,
    })

    const latencyMs = performance.now() - start
    const totalInput = usages.reduce(
      (acc, u) => acc + (u.inputTokens ?? u.promptTokens ?? 0),
      0
    )
    const totalOutput = usages.reduce(
      (acc, u) => acc + (u.outputTokens ?? u.completionTokens ?? 0),
      0
    )

    captureAIGeneration({
      provider: config.provider,
      modelId: config.model,
      feature: 'batch_screening_responses',
      usage: { inputTokens: totalInput, outputTokens: totalOutput },
      latencyMs,
      input: `Batch screening: ${papers.length} papers, ${questions.length} questions`,
      output: `Processed ${Object.keys(results).length} papers`,
    })

    return { results, errors }
  } catch (error) {
    const latencyMs = performance.now() - start
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
    })
    throw error
  }
}

export interface BatchTranslationParams {
  papers: BatchPaper[]
  sourceLanguage: string
  targetLanguage?: string
}

export async function generateBatchTranslations(
  params: BatchTranslationParams,
  config: AIConfig
): Promise<BatchTranslationResult> {
  const { papers, sourceLanguage, targetLanguage } = params

  if (papers.length === 0 || !sourceLanguage) {
    return { results: {}, errors: [] }
  }

  if (!config.apiKey) {
    throw new AIApiKeyRequiredError()
  }

  const model = await getProviderModel(config.provider, config.apiKey, config.model)
  const start = performance.now()

  try {
    const { results, errors, usages } = await processTranslationBatch({
      model,
      papers,
      sourceLanguage,
      targetLanguage,
    })

    const latencyMs = performance.now() - start
    const totalInput = usages.reduce(
      (acc, u) => acc + (u.inputTokens ?? u.promptTokens ?? 0),
      0
    )
    const totalOutput = usages.reduce(
      (acc, u) => acc + (u.outputTokens ?? u.completionTokens ?? 0),
      0
    )

    captureAIGeneration({
      provider: config.provider,
      modelId: config.model,
      feature: 'batch_translations',
      usage: { inputTokens: totalInput, outputTokens: totalOutput },
      latencyMs,
      input: `Batch translation: ${papers.length} papers, ${sourceLanguage} -> ${targetLanguage ?? 'auto'}`,
      output: `Processed ${Object.keys(results).length} papers`,
    })

    return { results, errors }
  } catch (error) {
    const latencyMs = performance.now() - start
    captureAIGeneration({
      provider: config.provider,
      modelId: config.model,
      feature: 'batch_translations',
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs,
      input: `Batch translation: ${papers.length} papers, ${sourceLanguage} -> ${targetLanguage ?? 'auto'}`,
      output: '',
      isError: true,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
