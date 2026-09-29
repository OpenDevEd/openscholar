'use client'

import { api } from '@/convex/_generated/api'
import {
  ESTIMATED_CREDITS_PER_PAPER,
  ESTIMATED_CREDITS_PER_QUERY,
} from '@/convex/lib/constants'
import * as clientExecutor from './executor'
import { createAIHook } from './hook-factory'
import { decodeQuestionResponseMap } from '../core/question-key-codec'

import type {
  EnhanceSearchQueryInput,
  GenerateScreeningQuestionsInput,
  GenerateExtractionQuestionsInput,
  TranslateQueryInput,
  TranslatePaperContentInput,
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

export type EnhanceSearchQueryParams = EnhanceSearchQueryInput
export type GenerateScreeningQuestionsParams = GenerateScreeningQuestionsInput
export type GenerateExtractionQuestionsParams = GenerateExtractionQuestionsInput
export type TranslateQueryParams = TranslateQueryInput
export type TranslatePaperContentParams = TranslatePaperContentInput
export type GenerateBatchScreeningResponsesParams = BatchScreeningParams
export type GenerateBatchTranslationsParams = BatchTranslationParams
export type { BatchScreeningResult, BatchTranslationResult }

export type { AIKeyMode }

export const useEnhanceSearchQuery = createAIHook(
  api.ai.actions.enhanceSearchQuery,
  clientExecutor.enhanceSearchQuery,
  undefined,
  { task: (params) => params.task ?? 'questionToQuery', estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY },
)

export const useGenerateScreeningQuestions = createAIHook(
  api.ai.actions.generateScreeningQuestions,
  clientExecutor.generateScreeningQuestions,
  undefined,
  { task: 'screening', estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY },
)

export const useGenerateExtractionQuestions = createAIHook(
  api.ai.actions.generateExtractionQuestions,
  clientExecutor.generateExtractionQuestions,
  undefined,
  { task: 'extraction', estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY },
)

export const useTranslateQuery = createAIHook(
  api.ai.actions.translateQuery,
  clientExecutor.translateQuery,
  undefined,
  { task: 'translate', estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY },
)

export const useTranslatePaperContent = createAIHook(
  api.ai.actions.translatePaperContent,
  clientExecutor.translatePaperContent,
  undefined,
  { task: 'translate', estimateCredits: () => ESTIMATED_CREDITS_PER_QUERY },
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
    task: 'screening',
    allowSmartLocalFallback: false,
    estimateCredits: (params) =>
      Math.ceil(params.papers.length * ESTIMATED_CREDITS_PER_PAPER),
  },
)

// Translation keeps the smart-mode local fallback enabled — fanning N papers
// through the user's local key is acceptable here (same UX path the single-op
// translate hooks already use), unlike batch screening which we force to
// server-only to keep coordination centralized.
export const useBatchTranslations = createAIHook(
  api.ai.actions.generateBatchTranslations,
  clientExecutor.generateBatchTranslations,
  undefined,
  {
    task: 'translate',
    estimateCredits: (params) =>
      Math.ceil(params.papers.length * ESTIMATED_CREDITS_PER_PAPER),
  },
)
