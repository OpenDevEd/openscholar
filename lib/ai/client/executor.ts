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
  formatOutput: (output: TOutput, params: TParams) => TResult
) {
  return async (params: TParams, config: AIConfig) => {
    if (!config.apiKey) {
      throw new AIApiKeyRequiredError()
    }
    const model = await getProviderModel(config.provider, config.apiKey, config.model)
    const operationConfig = configFactory(params)

    const { output } = await executeAIOperation({
      model,
      ...operationConfig,
    })

    return formatOutput(output, params)
  }
}

export const enhanceSearchQuery = createClientExecutor(
  getEnhanceQueryConfig,
  (output) => ({
    enhancedQuery: output.enhancedQuery,
    explanation: '',
  })
)

export const generateScreeningQuestions = createClientExecutor(
  getScreeningQuestionsConfig,
  (output) => ({
    questions: output.questions,
  })
)

export const generateExtractionQuestions = createClientExecutor(
  getExtractionQuestionsConfig,
  (output) => ({ questions: output.questions })
)

export const translateQuery = createClientExecutor(
  getTranslateQueryConfig,
  (output) => ({
    translatedQuery: output.translatedQuery,
  })
)

export const translatePaperContent = createClientExecutor(
  getTranslatePaperContentConfig,
  (output, params) => ({
    translatedTitle: output.translatedTitle,
    translatedAbstract: output.translatedAbstract,
    sourceLanguage: params.sourceLanguage,
    isAlreadyInEnglish: false,
  })
)

export const generateScreeningResponses = createClientExecutor(
  getScreeningResponsesConfig,
  (output) => ({
    responses: output.responses as Record<string, boolean | null>,
    confidence: output.confidence,
  })
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
  
  const { results, errors } = await processScreeningBatch({
    model,
    papers,
    questions,
  })

  return { results, errors }
}

export interface BatchTranslationParams {
  papers: BatchPaper[]
  sourceLanguage: string
}

export async function generateBatchTranslations(
  params: BatchTranslationParams,
  config: AIConfig
): Promise<BatchTranslationResult> {
  const { papers, sourceLanguage } = params

  if (papers.length === 0 || !sourceLanguage || sourceLanguage === 'en') {
    return { results: {}, errors: [] }
  }

  if (!config.apiKey) {
    throw new AIApiKeyRequiredError()
  }

  const model = await getProviderModel(config.provider, config.apiKey, config.model)
  
  const { results, errors } = await processTranslationBatch({
    model,
    papers,
    sourceLanguage,
  })

  return { results, errors }
}
