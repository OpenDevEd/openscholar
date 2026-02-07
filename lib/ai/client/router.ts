'use client'

import { api } from '@/convex/_generated/api'
import * as clientExecutor from './executor'
import { createAIHook } from './hook-factory'

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

export const useBatchScreeningResponses = createAIHook(
  api.ai.actions.generateBatchScreeningResponses,
  clientExecutor.generateBatchScreeningResponses
)

export const useBatchTranslations = createAIHook(
  api.ai.actions.generateBatchTranslations,
  clientExecutor.generateBatchTranslations
)
