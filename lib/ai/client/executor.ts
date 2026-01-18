import { z } from 'zod'
import { getProviderModel } from './providers'
import {
  queryEnhancementSchema,
  screeningQuestionsSchema,
  createScreeningResponsesSchema,
  translateQuerySchema,
  translatePaperContentSchema,
  buildEnhanceQueryPrompts,
  buildScreeningQuestionsPrompts,
  buildTranslateQueryPrompts,
  buildTranslatePaperContentPrompts,
  buildScreeningResponsesPrompts,
  validateQuery,
  executeAIOperation,
  AIApiKeyRequiredError,
} from '../core'
import type { AIProvider } from '@/lib/types'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  model: string
}

export interface EnhanceSearchQueryParams {
  query: string
  language?: string
}

export interface GenerateScreeningQuestionsParams {
  researchQuestion: string
  existingQuestions: string[]
}

export interface TranslateQueryParams {
  query: string
  targetLanguage: string
}

export interface TranslatePaperContentParams {
  title: string
  abstract: string
  sourceLanguage: string
}

export interface GenerateScreeningResponsesParams {
  title: string
  abstract: string
  questions: string[]
}

export async function enhanceSearchQuery(
  params: EnhanceSearchQueryParams,
  config: AIConfig
) {
  if (!config.apiKey) {
    throw new AIApiKeyRequiredError()
  }

  const model = await getProviderModel(config.provider, config.apiKey, config.model)

  const { output } = await executeAIOperation({
    model,
    schema: queryEnhancementSchema,
    buildPrompts: (input, retryCount) => buildEnhanceQueryPrompts(input, retryCount),
    input: params,
    repairStrategy: { type: 'single-field', fieldName: 'enhancedQuery' },
    temperature: 1,
    retryConfig: {
      maxRetries: 10,
      shouldRetry: (error, attempt) =>
        error.message.includes('unbalanced parentheses') ||
        error.message.includes('incomplete operator'),
      onRetry: (error, attempt) => {
        console.warn(`Query validation failed (attempt ${attempt}/10):`, error)
      },
    },
    validator: (output) => ({
      ...output,
      enhancedQuery: validateQuery(output.enhancedQuery),
    }),
  })

  return {
    enhancedQuery: output.enhancedQuery,
    explanation: '',
  }
}

export async function generateScreeningQuestions(
  params: GenerateScreeningQuestionsParams,
  config: AIConfig
) {
  if (!config.apiKey) {
    throw new AIApiKeyRequiredError()
  }

  const model = await getProviderModel(config.provider, config.apiKey, config.model)

  const { output } = await executeAIOperation({
    model,
    schema: screeningQuestionsSchema,
    buildPrompts: (input, retryCount) => buildScreeningQuestionsPrompts(input),
    input: params,
    repairStrategy: { type: 'full-json' },
    temperature: 0.7,
    postProcess: (output, input) => {
      const newQuestions = output.questions.filter((newQuestion: string) => {
        const normalizedNew = newQuestion.toLowerCase().trim()
        return !input.existingQuestions.some((existingQuestion: string) => {
          const normalizedExisting = existingQuestion.toLowerCase().trim()
          return (
            normalizedExisting === normalizedNew ||
            normalizedExisting.includes(normalizedNew) ||
            normalizedNew.includes(normalizedExisting)
          )
        })
      })
      return { questions: newQuestions }
    },
  })

  return {
    questions: output.questions,
  }
}

export async function translateQuery(
  params: TranslateQueryParams,
  config: AIConfig
) {
  if (!config.apiKey) {
    throw new AIApiKeyRequiredError()
  }

  const model = await getProviderModel(config.provider, config.apiKey, config.model)

  const { output } = await executeAIOperation({
    model,
    schema: translateQuerySchema,
    buildPrompts: (input, retryCount) => buildTranslateQueryPrompts(input),
    input: params,
    repairStrategy: { type: 'single-field', fieldName: 'translatedQuery' },
    temperature: 0.3,
  })

  return {
    translatedQuery: output.translatedQuery,
  }
}

export async function translatePaperContent(
  params: TranslatePaperContentParams,
  config: AIConfig
) {
  if (!config.apiKey) {
    throw new AIApiKeyRequiredError()
  }

  const model = await getProviderModel(config.provider, config.apiKey, config.model)

  const { output } = await executeAIOperation({
    model,
    schema: translatePaperContentSchema,
    buildPrompts: (input, retryCount) => buildTranslatePaperContentPrompts(input),
    input: params,
    repairStrategy: { type: 'full-json' },
    temperature: 0.3,
  })

  return {
    translatedTitle: output.translatedTitle,
    translatedAbstract: output.translatedAbstract,
    sourceLanguage: params.sourceLanguage,
    isAlreadyInEnglish: false,
  }
}

export async function generateScreeningResponses(
  params: GenerateScreeningResponsesParams,
  config: AIConfig
) {
  if (!config.apiKey) {
    throw new AIApiKeyRequiredError()
  }

  const model = await getProviderModel(config.provider, config.apiKey, config.model)
  const schema = createScreeningResponsesSchema(params.questions)

  const { output } = await executeAIOperation({
    model,
    schema,
    buildPrompts: (input, retryCount) => buildScreeningResponsesPrompts(input),
    input: params,
    repairStrategy: { type: 'full-json' },
    temperature: 0.1,
  })

  return {
    responses: output.responses as Record<string, boolean | null>,
    confidence: output.confidence,
  }
}