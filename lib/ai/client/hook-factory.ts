'use client'

import { useState, useCallback, useMemo } from 'react'
import { useAction } from 'convex/react'
import type { FunctionReference } from 'convex/server'
import { api } from '@/convex/_generated/api'
import { useAuthReadiness } from '@/components/providers/convex-provider'
import { useOptionalAuthQuery } from '@/lib/auth/use-auth-query'
import { useAIConfigStore } from '@/lib/store'
import { useFeatureFlag } from '@/lib/feature-flags/hook'
import { ESTIMATED_CREDITS_PER_QUERY } from '@/convex/lib/constants'
import {
  AIApiKeyRequiredError,
  AICreditsDisabledError,
  AIInsufficientCreditsError,
} from '@/lib/ai/core/errors'
import type { AIConfig } from './executor'
import {
  type AIExecutionErrorReason,
  resolveErrorCode,
  resolveCreditsAvailability,
  resolveExecutionDecision,
  resolveModeConfigurability,
  shouldRetrySmartWithLocalFallback,
} from './mode-routing'

export interface AIHookResult<TParams, TResult> {
  execute: (params: TParams) => Promise<TResult>
  isLoading: boolean
  error: Error | null
  isConfigured: boolean
}

interface AIHookOptions<TParams> {
  allowSmartLocalFallback?: boolean
  estimateCredits?: (params: TParams) => number
}

function mapExecutionError(reason: AIExecutionErrorReason): Error {
  if (reason === 'api_key_required') {
    return new AIApiKeyRequiredError()
  }
  if (reason === 'insufficient_credits') {
    return new AIInsufficientCreditsError()
  }
  return new AICreditsDisabledError()
}

function useLocalConfig(): AIConfig {
  const { provider, apiKey, model } = useAIConfigStore()
  return useMemo(
    () => ({ provider, apiKey, model }),
    [provider, apiKey, model]
  )
}

export function createAIHook<TParams extends Record<string, unknown>, TResult>(
  actionRef: FunctionReference<'action', 'public', TParams, TResult>,
  executorFn: (params: TParams, config: AIConfig) => Promise<TResult>,
  transformCreditsResult?: (result: TResult, params: TParams) => TResult,
  options: AIHookOptions<TParams> = {},
): () => AIHookResult<TParams, TResult> {
  return function useAIOperation() {
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    const { apiKeyMode } = useAIConfigStore()
    const localConfig = useLocalConfig()
    const hasApiKey = Boolean(localConfig.apiKey)
    const { phase } = useAuthReadiness()
    const isAuthenticated = phase === 'authenticated'
    const creditsEnabled = useFeatureFlag("credits.enabled")
    const creditsQuery = useOptionalAuthQuery(api.credits.queries.getMyBalance, {})
    const isConfigured = useMemo(
      () =>
        resolveModeConfigurability({
          mode: apiKeyMode,
          hasApiKey,
          creditsEnabled,
          isAuthenticated,
        }),
      [apiKeyMode, creditsEnabled, hasApiKey, isAuthenticated]
    )
    const convexAction = useAction(actionRef)

    const execute = useCallback(
      async (params: TParams) => {
        setIsLoading(true)
        setError(null)

        try {
          const requiredCredits = Math.ceil(
            Math.max(
              0,
              options.estimateCredits?.(params) ?? ESTIMATED_CREDITS_PER_QUERY
            )
          )
          const creditsAvailability = resolveCreditsAvailability({
            isAuthenticated,
            settlement: creditsQuery.settlement,
            totalCredits: creditsQuery.data?.total,
            requiredCredits,
          })

          const decision = resolveExecutionDecision({
            mode: apiKeyMode,
            hasApiKey,
            creditsEnabled,
            isAuthenticated,
            creditsAvailability,
          })

          if (decision.type === 'error') {
            throw mapExecutionError(decision.reason)
          }

          const runLocal = async () => {
            return executorFn(params, localConfig)
          }

          const runCredits = async () => {
            // Server-side path: server enforces the plan gate
            const result = await convexAction(params as never) as TResult
            return transformCreditsResult
              ? transformCreditsResult(result, params)
              : result
          }

          if (decision.target === 'local') {
            return await runLocal()
          }

          try {
            return await runCredits()
          } catch (creditsError) {
            const fallbackCode = resolveErrorCode(creditsError)
            if (
              options.allowSmartLocalFallback !== false &&
              shouldRetrySmartWithLocalFallback({
                mode: apiKeyMode,
                hasApiKey,
                errorCode: fallbackCode,
              })
            ) {
              return await runLocal()
            }
            throw creditsError
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          setError(error)
          throw error
        } finally {
          setIsLoading(false)
        }
      },
      [
        apiKeyMode,
        convexAction,
        creditsQuery.data?.total,
        creditsQuery.settlement,
        creditsEnabled,
        executorFn,
        hasApiKey,
        isAuthenticated,
        localConfig,
        options.allowSmartLocalFallback,
        options.estimateCredits,
        transformCreditsResult,
      ]
    )

    return useMemo(
      () => ({ execute, isLoading, error, isConfigured }),
      [execute, isLoading, error, isConfigured]
    )
  }
}
