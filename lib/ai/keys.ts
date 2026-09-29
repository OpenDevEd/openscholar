import type { AIProvider } from '@/lib/types/ai.types'
import { isVariant, toNativeModelId } from './native-model-id'

/** Providers a user can save a browser key for. OpenRouter's key runs every model. */
export const KEY_PROVIDERS = ['openai', 'google', 'anthropic', 'openrouter'] as const
export type KeyProvider = (typeof KEY_PROVIDERS)[number]

const vendorOf = (modelSlug: string) => modelSlug.split('/')[0] as KeyProvider

/** The saved key that can run a model: its own provider's, else OpenRouter's. */
export function keyFor(modelSlug: string, keys: Partial<Record<string, string>>): KeyProvider | null {
  const vendor = vendorOf(modelSlug)
  // OpenRouter-only variants (`:free`, `:extended`) run only there.
  if (!isVariant(modelSlug) && vendor !== 'openrouter' && KEY_PROVIDERS.includes(vendor) && keys[vendor]) return vendor
  return keys.openrouter ? 'openrouter' : null
}

/** The key to ask for when none can run the model. */
export function keyToAdd(modelSlug: string): KeyProvider {
  const vendor = vendorOf(modelSlug)
  return !isVariant(modelSlug) && KEY_PROVIDERS.includes(vendor) ? vendor : 'openrouter'
}

/** How a model is called on a key: OpenRouter takes the slug, a provider's own API its native id. */
export function keyModelId(modelSlug: string, provider: KeyProvider): string {
  return provider === 'openrouter' ? modelSlug : toNativeModelId(modelSlug, provider as Exclude<KeyProvider, 'openrouter'>)
}

export type { AIProvider }
