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
import { effectiveChoice, fallbackPreset, type AiTask } from '../tasks'
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
 * How each task runs on the user's own keys: the pick they run on (Custom's,
 * else their preset's, else the default preset's, as on the server), on
 * whichever saved key can run that model. Signed-in users on a preset, or
 * whose settings are still loading, run on credits.
 */
function useKeyConfigs(isAuthenticated: boolean, creditsEnabled: boolean) {
  const { provider, apiKey, providerApiKeys } = useAIConfigStore()
  const settings = useOptionalAuthQuery(api.userAiConfig.queries.get, {})
  const presets = useQuery(api.aiModelConfig.queries.presets, {})
  return useMemo(() => {
    const keys: Record<string, string> = { ...providerApiKeys, [provider]: apiKey }
    const saved = settings.data?.choice
    const choice = effectiveChoice(creditsEnabled, saved)
    const presetPicks = presets?.find((p) => p.preset === (choice === 'custom' ? fallbackPreset(saved) : choice))?.tasks
    const configFor = (task: AiTask): AIConfig => {
      const custom = choice === 'custom' ? settings.data?.custom.find((p) => p.task === task) : undefined
      const pick = custom?.model ? custom : presetPicks?.find((p) => p.task === task)
      const slug = pick?.model?.modelId
      const key = slug ? keyFor(slug, keys) : null
      return slug && key
        ? { provider: key, apiKey: keys[key]!, model: keyModelId(slug, key), effort: pick?.effort ?? undefined }
        : { provider: 'openrouter', apiKey: '', model: '' }
    }
    const loading = isAuthenticated && settings.settlement !== 'ready'
    return {
      configFor,
      onCredits: isAuthenticated && creditsEnabled && (loading || choice !== 'custom'),
    }
  }, [provider, apiKey, providerApiKeys, settings.data, settings.settlement, presets, isAuthenticated, creditsEnabled])
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
    const { phase } = useAuthReadiness()
    const isAuthenticated = phase === 'authenticated'
    const creditsEnabled = useFeatureFlag("credits.enabled")
    const { configFor, onCredits } = useKeyConfigs(isAuthenticated, creditsEnabled)
    // Setup checks the task this hook usually runs; a search hook's task depends on its call.
    const defaultTask = typeof options.task === 'function' ? options.task({} as TParams) : options.task
    // Presets run on credits; paying with your own key is part of Custom.
    const apiKeyMode = onCredits ? 'credits' : chosenMode
    const creditsQuery = useOptionalAuthQuery(api.billing.accounts.mine, {})
    const isConfigured = useMemo(
      () =>
        resolveModeConfigurability({
          mode: apiKeyMode,
          hasApiKey: Boolean(configFor(defaultTask).apiKey),
          creditsEnabled,
          isAuthenticated,
        }),
      [apiKeyMode, creditsEnabled, configFor, defaultTask, isAuthenticated]
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
