'use client'

import { useState, useCallback, useMemo } from 'react'
import { useAction } from 'convex/react'
import type { FunctionReference } from 'convex/server'
import { useAIConfigStore } from '@/lib/store'
import type { AIConfig } from './executor'

export interface AIHookResult<TParams, TResult> {
  execute: (params: TParams) => Promise<TResult>
  isLoading: boolean
  error: Error | null
  isConfigured: boolean
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
  transformCreditsResult?: (result: TResult, params: TParams) => TResult
): () => AIHookResult<TParams, TResult> {
  return function useAIOperation() {
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    const { apiKeyMode } = useAIConfigStore()
    const localConfig = useLocalConfig()
    const isConfigured = useIsConfigured()

    const convexAction = useAction(actionRef)

    const execute = useCallback(
      async (params: TParams) => {
        setIsLoading(true)
        setError(null)

        try {
          if (apiKeyMode === 'credits') {
            const result = await convexAction(params as any)
            return transformCreditsResult
              ? transformCreditsResult(result, params)
              : result
          } else {
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
      [apiKeyMode, convexAction, localConfig]
    )

    return useMemo(
      () => ({ execute, isLoading, error, isConfigured }),
      [execute, isLoading, error, isConfigured]
    )
  }
}
