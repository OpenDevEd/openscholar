'use client'

import { api } from '@/convex/_generated/api'
import {
  ESTIMATED_CREDITS_PER_PAPER,
  ESTIMATED_CREDITS_PER_QUERY,
} from '@/convex/lib/constants'
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
import type { AIKeyMode } from '@/lib/types'

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

export type { AIKeyMode }

export const useEnhanceSearchQuery = createAIHook(
  api.ai.actions.enhanceSearchQuery,
  clientExecutor.enhanceSearchQuery,
  undefined,
  { estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY }
)

export const useGenerateScreeningQuestions = createAIHook(
  api.ai.actions.generateScreeningQuestions,
  clientExecutor.generateScreeningQuestions,
  undefined,
  { estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY }
)

export const useGenerateExtractionQuestions = createAIHook(
  api.ai.actions.generateExtractionQuestions,
  clientExecutor.generateExtractionQuestions,
  undefined,
  { estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY }
)

export const useTranslateQuery = createAIHook(
  api.ai.actions.translateQuery,
  clientExecutor.translateQuery,
  undefined,
  { estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY }
)

export const useTranslatePaperContent = createAIHook(
  api.ai.actions.translatePaperContent,
  clientExecutor.translatePaperContent,
  undefined,
  { estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY }
)

export const useGenerateScreeningResponses = createAIHook(
  api.ai.actions.generateScreeningResponses,
  clientExecutor.generateScreeningResponses,
  (result) => ({
    ...result,
    responses: decodeQuestionResponseMap(result.responses),
  }),
  { estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY }
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
  }),
  {
    allowSmartLocalFallback: false,
    estimateCredits: (params) =>
      Math.ceil(params.papers.length * ESTIMATED_CREDITS_PER_PAPER),
  }
)

export const useBatchTranslations = createAIHook(
  api.ai.actions.generateBatchTranslations,
  clientExecutor.generateBatchTranslations,
  undefined,
  {
    estimateCredits: (params) =>
      Math.ceil(params.papers.length * ESTIMATED_CREDITS_PER_PAPER),
  }
)
