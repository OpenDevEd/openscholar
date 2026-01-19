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

// Batch screening types
export interface BatchScreeningPaper {
  id: string
  title: string
  abstract: string
}

export interface GenerateBatchScreeningResponsesParams {
  papers: BatchScreeningPaper[]
  questions: string[]
}

export interface BatchScreeningResult {
  results: Record<string, { responses: Record<string, boolean | null>; confidence: number }>
  errors: Array<{ paperId: string; error: string }>
}

/**
 * Client-side batch screening executor.
 * Processes multiple papers in parallel using Promise.allSettled for fail-soft behavior.
 */
export async function generateBatchScreeningResponses(
  params: GenerateBatchScreeningResponsesParams,
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
  const results: Record<string, { responses: Record<string, boolean | null>; confidence: number }> = {}
  const errors: Array<{ paperId: string; error: string }> = []

  // Process all papers in parallel
  const promises = papers.map(async (paper) => {
    const operationConfig = getScreeningResponsesConfig({
      title: paper.title,
      abstract: paper.abstract,
      questions,
    })

    const { output } = await executeAIOperation({
      model,
      ...operationConfig,
    })

    return {
      paperId: paper.id,
      responses: output.responses as Record<string, boolean | null>,
      confidence: output.confidence,
    }
  })

  const settledResults = await Promise.allSettled(promises)

  for (let i = 0; i < settledResults.length; i++) {
    const result = settledResults[i]
    if (result.status === 'fulfilled') {
      const { paperId, responses, confidence } = result.value
      results[paperId] = { responses, confidence }
    } else {
      const paperId = papers[i]?.id || 'unknown'
      const errorMessage = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason)
      errors.push({ paperId, error: errorMessage })
      console.error(`Batch screening error for paper ${paperId}:`, result.reason)
    }
  }

  return { results, errors }
}

// Batch translation types
export interface BatchTranslationPaper {
  id: string
  title: string
  abstract: string
}

export interface GenerateBatchTranslationsParams {
  papers: BatchTranslationPaper[]
  sourceLanguage: string
}

export interface TranslationData {
  translatedTitle: string
  translatedAbstract: string
  sourceLanguage: string
  isAlreadyInEnglish: boolean
}

export interface BatchTranslationResult {
  results: Record<string, TranslationData>
  errors: Array<{ paperId: string; error: string }>
}

/**
 * Client-side batch translation executor.
 * Processes multiple papers in parallel using Promise.allSettled for fail-soft behavior.
 */
export async function generateBatchTranslations(
  params: GenerateBatchTranslationsParams,
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
  const results: Record<string, TranslationData> = {}
  const errors: Array<{ paperId: string; error: string }> = []

  const promises = papers.map(async (paper) => {
    const operationConfig = getTranslatePaperContentConfig({
      title: paper.title,
      abstract: paper.abstract,
      sourceLanguage,
    })

    const { output } = await executeAIOperation({
      model,
      ...operationConfig,
    })

    return {
      paperId: paper.id,
      translatedTitle: output.translatedTitle,
      translatedAbstract: output.translatedAbstract,
      sourceLanguage,
      isAlreadyInEnglish: false,
    }
  })

  const settledResults = await Promise.allSettled(promises)

  for (let i = 0; i < settledResults.length; i++) {
    const result = settledResults[i]
    if (result.status === 'fulfilled') {
      const { paperId, translatedTitle, translatedAbstract, sourceLanguage, isAlreadyInEnglish } = result.value
      results[paperId] = { translatedTitle, translatedAbstract, sourceLanguage, isAlreadyInEnglish }
    } else {
      const paperId = papers[i]?.id || 'unknown'
      const errorMessage = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason)
      errors.push({ paperId, error: errorMessage })
      console.error(`Batch translation error for paper ${paperId}:`, result.reason)
    }
  }

  return { results, errors }
}
