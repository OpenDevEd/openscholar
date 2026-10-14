import { isVariant, toNativeModelId } from './native-model-id'
import { usableFor, type AiTask } from './tasks'

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

/** How a model is called on a key: OpenRouter takes the slug, a provider's own API its native id. */
export function keyModelId(modelSlug: string, provider: KeyProvider): string {
  return provider === 'openrouter' ? modelSlug : toNativeModelId(modelSlug, provider as Exclude<KeyProvider, 'openrouter'>)
}

type Price = { inputPricePerMillion: number; outputPricePerMillion: number }
type KeyOption = Price & { modelId: string; intelligenceIndex?: number; createdOnOpenRouter?: number; supportedParameters?: string[] }
const cost = (model: Price) => model.inputPricePerMillion + model.outputPricePerMillion

/**
 * Whether a key's provider serves a model, by its own list for the key: the model's id there, or a dated
 * release of it (`claude-sonnet-4-5-20250929`). Not every model under a provider's name runs there (`openai/gpt-oss-20b`).
 */
export const serves = (served: string[], modelSlug: string, provider: KeyProvider) => {
  const id = keyModelId(modelSlug, provider)
  return served.some((s) => s === id || (s.startsWith(`${id}-`) && /^\d/.test(s.slice(id.length + 1))))
}

/**
 * What a task moves to when no saved key can run its model: the smartest model the new key
 * serves for the task at no more than the old one cost, else its cheapest.
 */
export function modelForKey<T extends KeyOption>(task: AiTask, current: Price, provider: KeyProvider, catalog: T[], served: string[]): T | undefined {
  const options = catalog.filter(
    (model) => keyFor(model.modelId, { [provider]: provider }) === provider && serves(served, model.modelId, provider) && usableFor(model, task),
  )
  const within = options.filter((model) => cost(model) <= cost(current))
  if (!within.length) return options.toSorted((a, b) => cost(a) - cost(b))[0]
  return within.toSorted((a, b) => (b.intelligenceIndex ?? -1) - (a.intelligenceIndex ?? -1) || (b.createdOnOpenRouter ?? 0) - (a.createdOnOpenRouter ?? 0))[0]
}

/** Where each provider lists the models a key can use: asking costs nothing and proves the key. OpenRouter's key runs every model. */
const KEY_CHECKS: Record<KeyProvider, (key: string) => [string, Record<string, string>]> = {
  openai: (key) => ['https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` }],
  google: (key) => ['https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { 'x-goog-api-key': key }],
  anthropic: (key) => ['https://api.anthropic.com/v1/models?limit=1000', { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }],
  openrouter: (key) => ['https://openrouter.ai/api/v1/key', { Authorization: `Bearer ${key}` }],
}

type ModelList = { data?: Array<{ id: string }> | object; models?: Array<{ name: string }>; error?: { message?: string } }

/**
 * Whether the provider takes a key, with the model ids it serves on it; when it doesn't, its
 * reason, and no reason means it couldn't be reached.
 */
export async function checkKey(provider: KeyProvider, key: string): Promise<{ ok: true; served: string[] } | { ok: false; reason?: string }> {
  const [url, headers] = KEY_CHECKS[provider](key)
  const response = await fetch(url, { headers }).catch(() => null)
  if (!response) return { ok: false }
  const body = (await response.json().catch(() => null)) as ModelList | null
  if (!response.ok) {
    const reason = body?.error?.message ?? `HTTP ${response.status}`
    // An OpenAI restricted key can be allowed to run models without being allowed to list them: it's a working key.
    if (provider === 'openai' && /missing scopes/i.test(reason)) return { ok: true, served: [] }
    return { ok: false, reason }
  }
  // OpenAI and Anthropic list `data[].id`; Google lists `models[].name` as `models/<id>`; OpenRouter's `data` is the key itself.
  const listed = Array.isArray(body?.data) ? body.data.map((m: { id: string }) => m.id) : body?.models?.map((m) => m.name.replace(/^models\//, ''))
  return { ok: true, served: listed ?? [] }
}
