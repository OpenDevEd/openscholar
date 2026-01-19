import { getProviderModel } from './providers'
import {
  executeAIOperation,
  AIApiKeyRequiredError,
} from '../core'
import {
  getEnhanceQueryConfig,
  getScreeningQuestionsConfig,
  getTranslateQueryConfig,
  getTranslatePaperContentConfig,
  getScreeningResponsesConfig,
  type OperationConfig
} from '../core/configs'
import type { AIProvider } from '@/lib/types'
import type {
  EnhanceSearchQueryInput,
  GenerateScreeningQuestionsInput,
  TranslateQueryInput,
  TranslatePaperContentInput,
  GenerateScreeningResponsesInput,
} from '../core/types'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  model: string
}

// Re-export input types for backward compatibility or direct use
export type EnhanceSearchQueryParams = EnhanceSearchQueryInput
export type GenerateScreeningQuestionsParams = GenerateScreeningQuestionsInput
export type TranslateQueryParams = TranslateQueryInput
export type TranslatePaperContentParams = TranslatePaperContentInput
export type GenerateScreeningResponsesParams = GenerateScreeningResponsesInput

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
