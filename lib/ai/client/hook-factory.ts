'use client'

import { useState, useCallback, useMemo } from 'react'
import { useAction, useQuery } from 'convex/react'
import type { FunctionReference } from 'convex/server'
import type { Id } from '@/convex/_generated/dataModel'
import { api } from '@/convex/_generated/api'
import { useAuthReadiness } from '@/components/providers/convex-provider'
import { useOptionalAuthQuery } from '@/lib/auth/use-auth-query'
import { useAIConfigStore } from '@/lib/store'
import { inWorkspace, useWorkspace, useWorkspaceScope } from '@/lib/workspaces/url'
import { useWorkspaceSlug } from '@/lib/workspaces/href'
import { useFeatureFlag } from '@/lib/feature-flags/hook'
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
  /** Whether it's known who pays: until then `execute` could choose wrongly, which only matters to work no one pressed a button for. */
  isReady: boolean
  /** What one press costs in credits, said on its button (components/ui/button-credits.tsx). None where it isn't paid in credits. */
  credits: number | undefined
}

export interface AIHookOptions<TParams> {
  /** Which task this is, which picks its model and key. */
  task: AiTask | ((params: TParams) => AiTask)
  /** What the work is, which prices it on the task's model (convex/ai/estimates.ts): one helper call unless it says otherwise. */
  estimate?: (params: TParams) => { kind: 'helper' | 'paper'; calls: number }
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
 * How each task runs on the user's own keys: the pick they run on (signed out,
 * this browser's; signed in, Custom's, else their preset's; else the default
 * preset's, as on the server), on whichever saved key can run that model.
 * Signed-in users on a preset, or whose settings are still loading, run on credits.
 */
function useKeyConfigs(isAuthenticated: boolean, signedOut: boolean, creditsEnabled: boolean) {
  const { provider, apiKey, providerApiKeys, picks } = useAIConfigStore()
  // An organization's work runs on its preset, on its credits: no one's own keys (#651). Known from
  // the address, so nothing runs on someone's own key while the organization loads.
  const inOrganization = useWorkspaceSlug() !== undefined
  const settings = useOptionalAuthQuery(api.userAiConfig.queries.get, {})
  const presets = useQuery(api.aiModelConfig.queries.presetPicks, {})
  return useMemo(() => {
    const keys: Record<string, string> = { ...providerApiKeys, [provider]: apiKey }
    const saved = settings.data?.choice
    const choice = effectiveChoice(creditsEnabled, saved)
    const presetPicks = presets?.[choice === 'custom' ? fallbackPreset(saved) : choice]
    const configFor = (task: AiTask): AIConfig => {
      const browser = signedOut ? picks[task] : undefined
      const custom = choice === 'custom' ? settings.data?.custom.find((p) => p.task === task) : undefined
      const pick = custom?.model ? custom : presetPicks?.find((p) => p.task === task)
      const slug = browser?.id ?? pick?.model?.modelId
      const effort = browser ? browser.effort : (pick?.effort ?? undefined)
      const key = slug ? keyFor(slug, keys) : null
      return slug && key
        ? { provider: key, apiKey: keys[key]!, model: keyModelId(slug, key), effort }
        : { provider: 'openrouter', apiKey: '', model: '' }
    }
    const loading = isAuthenticated && settings.settlement !== 'ready'
    return {
      configFor,
      settled: presets !== undefined && (signedOut || settings.settlement === 'ready'),
      onCredits: isAuthenticated && (inOrganization || (creditsEnabled && (loading || choice !== 'custom'))),
    }
  }, [provider, apiKey, providerApiKeys, picks, settings.data, settings.settlement, presets, isAuthenticated, signedOut, creditsEnabled, inOrganization])
}

export function createAIHook<TArgs extends Record<string, unknown>, TResult>(
  // The hook adds the page's workspace, which pays (#650).
  actionRef: FunctionReference<'action', 'public', TArgs, TResult>,
  executorFn: (params: Omit<TArgs, 'workspaceId'>, config: AIConfig) => Promise<TResult>,
  transformCreditsResult: ((result: TResult, params: Omit<TArgs, 'workspaceId'>) => TResult) | undefined,
  options: AIHookOptions<Omit<TArgs, 'workspaceId'>>,
): () => AIHookResult<Omit<TArgs, 'workspaceId'>, TResult> {
  type TParams = Omit<TArgs, 'workspaceId'>
  return function useAIOperation() {
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)

    const { apiKeyMode: chosenMode } = useAIConfigStore()
    const { phase } = useAuthReadiness()
    const isAuthenticated = phase === 'authenticated'
    // Known to be signed out, not still signing in: a signed-in person never runs on keys meant for signed out.
    const signedOut = phase === 'anonymous'
    const creditsEnabled = useFeatureFlag("credits.enabled")
    const { configFor, settled, onCredits } = useKeyConfigs(isAuthenticated, signedOut, creditsEnabled)
    // Setup checks the task this hook usually runs; a search hook's task depends on its call.
    const defaultTask = typeof options.task === 'function' ? options.task({} as TParams) : options.task
    // Presets run on credits; paying with your own key is part of Custom. Signed out, only a key can pay.
    const apiKeyMode = onCredits ? 'credits' : signedOut ? 'local' : chosenMode
    const creditsQuery = useOptionalAuthQuery(api.billing.accounts.mine, useWorkspaceScope())
    const figures = useOptionalAuthQuery(api.ai.estimates.mine, inWorkspace(useWorkspace(), {}))
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
    // Work on credits is paid by the page's workspace (#650).
    const workspaceId = useWorkspace()

    const isReady = settled && (signedOut || (workspaceId !== undefined && creditsQuery.settlement === 'ready' && figures.settlement === 'ready'))

    const execute = useCallback(
      async (params: TParams) => {
        setIsLoading(true)
        setError(null)

        try {
          const task = typeof options.task === 'function' ? options.task(params) : options.task
          const localConfig = configFor(task)
          const hasApiKey = Boolean(localConfig.apiKey)
          const work = options.estimate?.(params) ?? { kind: 'helper', calls: 1 }
          const requiredCredits = work.calls * (figures.data?.[task]?.[work.kind] ?? 0)
          // Adapter: useOptionalAuthQuery's settlement union doesn't match the
          // CreditsSettlement union. "ready" is the only "settled" state; every
          // other auth/query phase reads as "loading" for the credit check.
          const settlement: CreditsSettlement =
            creditsQuery.settlement === 'ready' && figures.settlement === 'ready' ? 'settled' : 'loading'
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
            if (!workspaceId) throw new Error("The workspace hasn't loaded yet. Try again in a moment.")
            const result = await convexAction({ ...params, workspaceId } as never) as TResult
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
        workspaceId,
        creditsEnabled,
        creditsQuery.data?.balance,
        creditsQuery.settlement,
        figures.data,
        figures.settlement,
        configFor,
        executorFn,
        isAuthenticated,
        options,
        transformCreditsResult,
      ]
    )

    // One press, priced as the work is checked against the balance: its task's model, at the price of one helper call.
    const credits = apiKeyMode === 'credits' ? figures.data?.[defaultTask]?.helper : undefined
    return useMemo(
      () => ({ execute, isLoading, error, isConfigured, isReady, credits }),
      [execute, isLoading, error, isConfigured, isReady, credits]
    )
  }
}
