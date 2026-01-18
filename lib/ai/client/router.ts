'use client'

import { api } from '@/convex/_generated/api'
import * as clientExecutor from './executor'
import { createAIHook } from './hook-factory'
import type {
  EnhanceSearchQueryParams,
  GenerateScreeningQuestionsParams,
  TranslateQueryParams,
  TranslatePaperContentParams,
  GenerateScreeningResponsesParams,
} from './executor'

// Re-export param types for convenience
export type {
  EnhanceSearchQueryParams,
  GenerateScreeningQuestionsParams,
  TranslateQueryParams,
  TranslatePaperContentParams,
  GenerateScreeningResponsesParams,
}

export type AIKeyMode = 'local' | 'credits'

export const useEnhanceSearchQuery = createAIHook(
  api.ai.actions.enhanceSearchQuery,
  clientExecutor.enhanceSearchQuery
)

export const useGenerateScreeningQuestions = createAIHook(
  api.ai.actions.generateScreeningQuestions,
  clientExecutor.generateScreeningQuestions
)

export const useTranslateQuery = createAIHook(
  api.ai.actions.translateQuery,
  clientExecutor.translateQuery
)

export const useTranslatePaperContent = createAIHook(
  api.ai.actions.translatePaperContent,
  clientExecutor.translatePaperContent
)

export const useGenerateScreeningResponses = createAIHook(
  api.ai.actions.generateScreeningResponses,
  clientExecutor.generateScreeningResponses
)
