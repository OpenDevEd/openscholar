import { describe, expect, it } from 'vitest'
import { modelForKey } from './keys'

const model = (modelId: string, input: number, output: number, intelligenceIndex?: number, structured = true) => ({
  modelId,
  inputPricePerMillion: input,
  outputPricePerMillion: output,
  intelligenceIndex,
  supportedParameters: structured ? ['structured_outputs'] : [],
})

const catalog = [
  model('anthropic/claude-sonnet-5.5', 3, 15, 70),
  model('openai/gpt-6-sol', 5, 30, 80),
  model('openai/gpt-6-luna', 1, 8, 65),
  model('openai/gpt-5-nano', 0.05, 0.4, 40),
  model('openai/gpt-6-luna:free', 0, 0, 65),
  model('openai/gpt-chat-latest', 0.5, 2, 75, false),
  model('openai/gpt-oss-20b', 0.02, 0.09, 30),
  model('google/gemini-3.5-flash', 0.3, 2.5, 72),
]
// What OpenAI's own list has: no open-weight gpt-oss, and a dated release of gpt-5-nano.
const served = ['gpt-6-sol', 'gpt-6-luna', 'gpt-5-nano-2025-08-07', 'gpt-chat-latest']

describe('modelForKey', () => {
  it('runs a task on the smartest model the key can run that costs no more', () => {
    const claude = catalog[0]!
    expect(modelForKey('questionToQuery', claude, 'openai', catalog, served)?.modelId).toBe('openai/gpt-6-luna')
  })

  it('falls back to the cheapest model the key serves when every one costs more', () => {
    const jev = model('typesafe/jev-1.13', 0.04, 0, undefined)
    expect(modelForKey('screening', jev, 'openai', catalog, served)?.modelId).toBe('openai/gpt-5-nano')
  })

  it('finds nothing when the provider has no model for the task', () => {
    expect(modelForKey('refine', catalog[0]!, 'anthropic', catalog.slice(1), ['claude-sonnet-5-5'])).toBeUndefined()
  })
})
