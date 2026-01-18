import { useAIConfigStore } from '@/lib/store'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import * as localActions from '@/app/actions/ai-enhance'
import type { AIProvider } from '@/lib/types'

export type AIKeyMode = 'local' | 'credits'

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

export function createAIRouter() {
  const getAIConfig = () => {
    const state = useAIConfigStore.getState()
    return {
      apiKeyMode: state.apiKeyMode,
      provider: state.provider,
      apiKey: state.apiKey,
      model: state.model,
    }
  }

  return {
    async enhanceSearchQuery(params: EnhanceSearchQueryParams) {
      const config = getAIConfig()

      if (config.apiKeyMode === 'credits') {
        throw new Error('Use useEnhanceSearchQuery hook for credits mode')
      }

      return localActions.enhanceSearchQuery(
        params.query,
        config.provider,
        config.apiKey,
        config.model,
        params.language
      )
    },
  }
}

export function useEnhanceSearchQuery() {
  const convexMutation = useMutation(api.ai.actions.enhanceSearchQuery)
  const { apiKeyMode, provider, apiKey, model } = useAIConfigStore()

  return async (params: EnhanceSearchQueryParams) => {
    if (apiKeyMode === 'credits') {
      return convexMutation(params)
    }

    return localActions.enhanceSearchQuery(
      params.query,
      provider,
      apiKey,
      model,
      params.language
    )
  }
}

export function useGenerateScreeningQuestions() {
  const convexMutation = useMutation(api.ai.actions.generateScreeningQuestions)
  const { apiKeyMode, provider, apiKey, model } = useAIConfigStore()

  return async (params: GenerateScreeningQuestionsParams) => {
    if (apiKeyMode === 'credits') {
      return convexMutation(params)
    }

    return localActions.generateScreeningQuestions(
      params.researchQuestion,
      params.existingQuestions,
      provider,
      apiKey,
      model
    )
  }
}

export function useTranslateQuery() {
  const convexMutation = useMutation(api.ai.actions.translateQuery)
  const { apiKeyMode, provider, apiKey, model } = useAIConfigStore()

  return async (params: TranslateQueryParams) => {
    if (apiKeyMode === 'credits') {
      return convexMutation(params)
    }

    return localActions.translateQuery(
      params.query,
      params.targetLanguage,
      provider,
      apiKey,
      model
    )
  }
}

export function useTranslatePaperContent() {
  const convexMutation = useMutation(api.ai.actions.translatePaperContent)
  const { apiKeyMode, provider, apiKey, model } = useAIConfigStore()

  return async (params: TranslatePaperContentParams) => {
    if (apiKeyMode === 'credits') {
      return convexMutation(params)
    }

    return localActions.translatePaperContent(
      params.title,
      params.abstract,
      params.sourceLanguage,
      provider,
      apiKey,
      model
    )
  }
}

export function useGenerateScreeningResponses() {
  const convexMutation = useMutation(api.ai.actions.generateScreeningResponses)
  const { apiKeyMode, provider, apiKey, model } = useAIConfigStore()

  return async (params: GenerateScreeningResponsesParams) => {
    if (apiKeyMode === 'credits') {
      return convexMutation(params)
    }

    return localActions.generateScreeningResponses(
      params.title,
      params.abstract,
      params.questions,
      provider,
      apiKey,
      model
    )
  }
}