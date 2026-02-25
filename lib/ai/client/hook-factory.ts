'use client'

import { useState, useCallback, useMemo } from 'react'
import { useAction } from 'convex/react'
import type { FunctionReference } from 'convex/server'
import { useAIConfigStore } from '@/lib/store'
import { useSubscriptionState } from '@/lib/auth/use-subscription-state'
import { AIPlanEntitlementError } from '@/lib/ai/core/errors'
import type { AIConfig } from './executor'

export interface AIHookResult<TParams, TResult> {
  execute: (params: TParams) => Promise<TResult>
  isLoading: boolean
  error: Error | null
  isConfigured: boolean
  isPlanEntitled: boolean
}

function useIsConfigured(): boolean {
  const { apiKeyMode, apiKey } = useAIConfigStore()
  if (apiKeyMode === 'local') {
    return !!apiKey
  }
  return true
}

function useLocalConfig(): AIConfig {
  const { provider, apiKey, model } = useAIConfigStore()
  return useMemo(
    () => ({ provider, apiKey, model }),
    [provider, apiKey, model]
  )
}

export function createAIHook<TParams extends Record<string, any>, TResult>(
  actionRef: FunctionReference<'action', 'public', TParams, TResult>,
  executorFn: (params: TParams, config: AIConfig) => Promise<TResult>,
  transformCreditsResult?: (result: TResult, params: TParams) => TResult,
  options?: { minPlanTier?: number }
): () => AIHookResult<TParams, TResult> {
  return function useAIOperation() {
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    const { apiKeyMode } = useAIConfigStore()
    const localConfig = useLocalConfig()
    const isConfigured = useIsConfigured()
    const { resolvedTier, isSettling } = useSubscriptionState()

    // A hook is plan-entitled if there's no tier requirement, or the user's tier meets it.
    // While settling, treat as not entitled (conservative).
    const isPlanEntitled = options?.minPlanTier
      ? !isSettling && resolvedTier !== null && resolvedTier >= options.minPlanTier
      : true

    const convexAction = useAction(actionRef)

    const execute = useCallback(
      async (params: TParams) => {
        setIsLoading(true)
        setError(null)

        try {
          if (apiKeyMode === 'credits') {
            // Server-side path: server enforces the plan gate
            const result = await convexAction(params as any)
            return transformCreditsResult
              ? transformCreditsResult(result, params)
              : result
          } else {
            // BYOK path: enforce plan gate client-side before calling the executor
            if (options?.minPlanTier && !isPlanEntitled) {
              throw new AIPlanEntitlementError('Go')
            }
            return await executorFn(params, localConfig)
          }
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          setError(error)
          throw error
        } finally {
          setIsLoading(false)
        }
      },
      [apiKeyMode, convexAction, localConfig, isPlanEntitled]
    )

    return useMemo(
      () => ({ execute, isLoading, error, isConfigured, isPlanEntitled }),
      [execute, isLoading, error, isConfigured, isPlanEntitled]
    )
  }
}
