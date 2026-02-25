'use client'

import { api } from '@/convex/_generated/api'
import * as clientExecutor from './executor'
import { createAIHook } from './hook-factory'
import { decodeQuestionResponseMap } from '../core/question-key-codec'

// Import types from their canonical locations
import type {
  EnhanceSearchQueryInput,
  GenerateScreeningQuestionsInput,
  GenerateExtractionQuestionsInput,
  TranslateQueryInput,
  TranslatePaperContentInput,
  GenerateScreeningResponsesInput,
} from '../core/types'
import type {
  BatchScreeningResult,
  BatchTranslationResult,
} from '../core/batch-types'
import type {
  BatchScreeningParams,
  BatchTranslationParams,
} from './executor'

// Export types for external consumers
export type EnhanceSearchQueryParams = EnhanceSearchQueryInput
export type GenerateScreeningQuestionsParams = GenerateScreeningQuestionsInput
export type GenerateExtractionQuestionsParams = GenerateExtractionQuestionsInput
export type TranslateQueryParams = TranslateQueryInput
export type TranslatePaperContentParams = TranslatePaperContentInput
export type GenerateScreeningResponsesParams = GenerateScreeningResponsesInput
export type GenerateBatchScreeningResponsesParams = BatchScreeningParams
export type GenerateBatchTranslationsParams = BatchTranslationParams
export type { BatchScreeningResult, BatchTranslationResult }

export type AIKeyMode = 'local' | 'credits'

export const useEnhanceSearchQuery = createAIHook(
  api.ai.actions.enhanceSearchQuery,
  clientExecutor.enhanceSearchQuery
)

export const useGenerateScreeningQuestions = createAIHook(
  api.ai.actions.generateScreeningQuestions,
  clientExecutor.generateScreeningQuestions
)

export const useGenerateExtractionQuestions = createAIHook(
  api.ai.actions.generateExtractionQuestions,
  clientExecutor.generateExtractionQuestions
)

export const useTranslateQuery = createAIHook(
  api.ai.actions.translateQuery,
  clientExecutor.translateQuery,
  undefined,
  { minPlanTier: 10 }
)

export const useTranslatePaperContent = createAIHook(
  api.ai.actions.translatePaperContent,
  clientExecutor.translatePaperContent,
  undefined,
  { minPlanTier: 10 }
)

export const useGenerateScreeningResponses = createAIHook(
  api.ai.actions.generateScreeningResponses,
  clientExecutor.generateScreeningResponses,
  (result) => ({
    ...result,
    responses: decodeQuestionResponseMap(result.responses),
  })
)

export const useBatchScreeningResponses = createAIHook(
  api.ai.actions.generateBatchScreeningResponses,
  clientExecutor.generateBatchScreeningResponses,
  (result) => ({
    ...result,
    results: Object.fromEntries(
      Object.entries(result.results).map(([paperId, data]) => [
        paperId,
        {
          ...data,
          responses: decodeQuestionResponseMap(data.responses),
        },
      ])
    ),
  })
)

export const useBatchTranslations = createAIHook(
  api.ai.actions.generateBatchTranslations,
  clientExecutor.generateBatchTranslations,
  undefined,
  { minPlanTier: 10 }
)
