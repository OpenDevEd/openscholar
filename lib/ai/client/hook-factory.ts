'use client'

import { useState, useCallback, useMemo } from 'react'
import { useAction, useQuery } from 'convex/react'
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
import { keyFor, keyModelId } from '../keys'
import { DEFAULT_PRESET, type AiTask } from '../tasks'
import {
  type AIExecutionErrorReason,
  type CreditsSettlement,
  resolveCreditsAvailability,
  resolveErrorCode,
  resolveExecutionDecision,
  resolveFallbackToLocal,
  resolveModeConfigurability,
} from './mode-routing'

export interface AIHookResult<TParams, TResult> {
  execute: (params: TParams) => Promise<TResult>
  isLoading: boolean
  error: Error | null
  isConfigured: boolean
}

export interface AIHookOptions<TParams> {
  /** Which task this is, which picks its model and key. */
  task: AiTask | ((params: TParams) => AiTask)
  estimateCredits?: (params: TParams) => number
  allowSmartLocalFallback?: boolean
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

/**
 * How each task runs on the user's own keys: Custom's pick for it (the default
 * preset's when signed out), on whichever saved key can run that model.
 * Signed-in users on a preset always run on credits.
 */
function useKeyConfigs() {
  const { provider, apiKey, providerApiKeys } = useAIConfigStore()
  const settings = useOptionalAuthQuery(api.userAiConfig.queries.get, {})
  const presets = useQuery(api.aiModelConfig.queries.presets, {})
  const onCustom = settings.data?.choice === 'custom'
  return useMemo(() => {
    const keys: Record<string, string> = { ...providerApiKeys, [provider]: apiKey }
    const picks = onCustom
      ? settings.data?.custom
      : presets?.find((p) => p.preset === DEFAULT_PRESET)?.tasks
    const configFor = (task: AiTask): AIConfig => {
      const pick = picks?.find((p) => p.task === task)
      const slug = pick?.model?.modelId
      const key = slug ? keyFor(slug, keys) : null
      return slug && key
        ? { provider: key, apiKey: keys[key]!, model: keyModelId(slug, key), effort: pick?.effort ?? undefined }
        : { provider: 'openrouter', apiKey: '', model: '' }
    }
    return { configFor, onPreset: settings.data !== undefined && !onCustom, anyKey: Object.values(keys).some(Boolean) }
  }, [provider, apiKey, providerApiKeys, onCustom, settings.data, presets])
}

export function createAIHook<TParams extends Record<string, unknown>, TResult>(
  actionRef: FunctionReference<'action', 'public', TParams, TResult>,
  executorFn: (params: TParams, config: AIConfig) => Promise<TResult>,
  transformCreditsResult: ((result: TResult, params: TParams) => TResult) | undefined,
  options: AIHookOptions<TParams>,
): () => AIHookResult<TParams, TResult> {
  return function useAIOperation() {
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    const { apiKeyMode: chosenMode } = useAIConfigStore()
    const { configFor, onPreset, anyKey } = useKeyConfigs()
    // Presets run on credits; paying with your own key is part of Custom.
    const apiKeyMode = onPreset ? 'credits' : chosenMode
    const { phase } = useAuthReadiness()
    const isAuthenticated = phase === 'authenticated'
    const creditsEnabled = useFeatureFlag("credits.enabled")
    const creditsQuery = useOptionalAuthQuery(api.billing.accounts.mine, {})
    const isConfigured = useMemo(
      () =>
        resolveModeConfigurability({
          mode: apiKeyMode,
          hasApiKey: anyKey,
          creditsEnabled,
          isAuthenticated,
        }),
      [apiKeyMode, creditsEnabled, anyKey, isAuthenticated]
    )
    const convexAction = useAction(actionRef)

    const execute = useCallback(
      async (params: TParams) => {
        setIsLoading(true)
        setError(null)

        try {
          const task = typeof options.task === 'function' ? options.task(params) : options.task
          const localConfig = configFor(task)
          const hasApiKey = Boolean(localConfig.apiKey)
          const requiredCredits = Math.max(
            0,
            Math.ceil(
              options.estimateCredits?.(params) ?? ESTIMATED_CREDITS_PER_QUERY
            )
          )
          // Adapter: useOptionalAuthQuery's settlement union doesn't match the
          // CreditsSettlement union. "ready" is the only "settled" state; every
          // other auth/query phase reads as "loading" for the credit check.
          const settlement: CreditsSettlement =
            creditsQuery.settlement === 'ready' ? 'settled' : 'loading'
          const creditsAvailability = resolveCreditsAvailability({
            isAuthenticated,
            settlement,
            totalCredits: creditsQuery.data?.balance,
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
              resolveFallbackToLocal({
                allowSmartLocalFallback: options.allowSmartLocalFallback,
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
        creditsEnabled,
        creditsQuery.data?.balance,
        creditsQuery.settlement,
        configFor,
        executorFn,
        isAuthenticated,
        options,
        transformCreditsResult,
      ]
    )

    return useMemo(
      () => ({ execute, isLoading, error, isConfigured }),
      [execute, isLoading, error, isConfigured]
    )
  }
}
