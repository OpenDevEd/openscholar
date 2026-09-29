import type { generateText, LanguageModel } from 'ai'

/** Reasoning effort, from OpenRouter's scale. Providers without a level round to their nearest. */
export const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]['providerOptions']>

export interface CallOptionsArgs {
  /** Omitted: OpenRouter uses the model's own default; direct keys keep thinking minimal. */
  effort?: Effort
  /** Keeps one conversation or job on the same upstream host, so its prompt cache stays warm. */
  sessionId?: string
  /**
   * Ask Anthropic models to cache the prompt. Only for prompts that repeat (chat turns):
   * a cache write costs 1.25× input, which a one-off call never earns back.
   */
  cache?: boolean
}

/** The nearest level in `allowed` at or below `effort`, else the lowest. */
export function clamp<T extends Effort>(effort: Effort, allowed: readonly T[]): T {
  const rank = EFFORTS.indexOf(effort)
  const fits = allowed.filter((level) => EFFORTS.indexOf(level) <= rank)
  return fits.at(-1) ?? allowed[0]!
}

/**
 * Provider options for one AI call: reasoning effort in each provider's own shape,
 * plus prompt caching and sticky routing on OpenRouter. The provider and model come
 * from the model itself, so one helper serves credits, OpenRouter keys and direct keys.
 */
export function callOptions(model: LanguageModel, { effort, sessionId, cache }: CallOptionsArgs = {}): ProviderOptions {
  const provider = typeof model === 'string' ? 'gateway' : model.provider.split('.')[0]
  const modelId = typeof model === 'string' ? model : model.modelId

  switch (provider) {
    case 'openrouter':
      return {
        openrouter: {
          // The SDK's types stop at xhigh, but the API takes max.
          ...(effort && { reasoning: { effort } }),
          ...(cache && modelId.startsWith('anthropic/') && { cache_control: { type: 'ephemeral' } }),
          // Not in the SDK's types; it passes unknown keys through to the request body.
          ...(sessionId && { session_id: sessionId.slice(0, 256) }),
        },
      }
    case 'openai':
    case 'azure':
      // Azure's SDK reads the `openai` key as well as its own.
      return {
        openai: { reasoningEffort: effort ? clamp(effort, ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']) : 'minimal' },
      }
    case 'google':
      return {
        google: {
          thinkingConfig: effort
            ? { thinkingLevel: clamp(effort, ['minimal', 'low', 'medium', 'high']) }
            : { thinkingBudget: 0, thinkingLevel: 'minimal' },
        },
      }
    case 'anthropic':
      return effort && effort !== 'none' && effort !== 'minimal'
        ? { anthropic: { effort: clamp(effort, ['low', 'medium', 'high', 'max']) } }
        : {}
    default:
      return {}
  }
}
