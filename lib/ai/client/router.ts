'use client'

import { api } from '@/convex/_generated/api'
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
  { task: (params) => params.task ?? 'questionToQuery' },
)

export const useGenerateScreeningQuestions = createAIHook(
  api.ai.actions.generateScreeningQuestions,
  clientExecutor.generateScreeningQuestions,
  undefined,
  // Writing questions needs a text model; the Screening pick may be Jev, which only answers them.
  { task: 'extraction' },
)

export const useGenerateExtractionQuestions = createAIHook(
  api.ai.actions.generateExtractionQuestions,
  clientExecutor.generateExtractionQuestions,
  undefined,
  { task: 'extraction' },
)

export const useTranslateQuery = createAIHook(
  api.ai.actions.translateQuery,
  clientExecutor.translateQuery,
  undefined,
  { task: 'translate' },
)

export const useTranslatePaperContent = createAIHook(
  api.ai.actions.translatePaperContent,
  clientExecutor.translatePaperContent,
  undefined,
  { task: 'translate' },
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
          confidences: decodeQuestionResponseMap(data.confidences),
        },
      ])
    ),
  }),
  {
    task: 'screening',
    allowSmartLocalFallback: false,
    estimate: (params) => ({ kind: 'paper', calls: params.papers.length }),
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
    // A paper's title and abstract translated is a helper call (convex/ai/actions.ts).
    estimate: (params) => ({ kind: 'helper', calls: params.papers.length }),
  },
)
