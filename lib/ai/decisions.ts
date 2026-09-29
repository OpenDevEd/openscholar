import type { Usage } from './core/types'

/**
 * TypeSafe's Jev answers typed questions about a text instead of writing text.
 * OpenRouter serves it only through the Decisions API, not chat completions.
 */
export const JEV_MODEL = 'typesafe/jev-1.13'
const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions'

/** Models answered through the Decisions API rather than text generation. */
export const isDecisionModel = (modelSlug: string) => modelSlug.startsWith('typesafe/jev')

/** A failed decisions call, with the HTTP status the error classifier reads. */
export class DecisionsError extends Error {
  constructor(readonly status: number, detail: string) {
    super(`Jev decision failed (${status}): ${detail}`)
    this.name = 'DecisionsError'
  }
}

// Jev reads 32K tokens. Leave room for the criteria, the JSON around each question
// and the paper's field names.
const MAX_REQUEST_TOKENS = 28_000
const PER_QUESTION_TOKENS = 80
const TIMEOUT_MS = 60_000

// ponytail: measured against Jev's usage: English runs ~0.15 tokens a character, while
// digits, punctuation and Chinese run ~1 and an emoji 3. Letters count a quarter, other
// characters 1, characters beyond the BMP 3. Use a tokenizer if papers get cut short.
const tokensOf = (char: string) => (/[A-Za-z]/.test(char) ? 0.25 : char.length > 1 ? 3 : 1)

/** The longest start of `text` within `budget` tokens, cut between whole characters, and its tokens. */
function within(text: string, budget: number) {
  let tokens = 0
  let end = 0
  for (const char of text) {
    if (tokens + tokensOf(char) > budget) break
    tokens += tokensOf(char)
    end += char.length
  }
  return { text: text.slice(0, end), tokens }
}
const tokensIn = (text: string) => within(text, Infinity).tokens

/**
 * A paper as Jev reads it, within its context: the title and questions always fit,
 * then the abstract, then as much full text as is left.
 */
export function paperState(paper: { title: string; abstract?: string; fullText?: string }, questions: string[]) {
  let room = MAX_REQUEST_TOKENS - tokensIn(paper.title)
  for (const question of questions) room -= tokensIn(question) + PER_QUESTION_TOKENS
  const abstract = within(paper.abstract ?? '', room)
  const fullText = within(paper.fullText ?? '', room - abstract.tokens).text
  return { title: paper.title, ...(abstract.text && { abstract: abstract.text }), ...(fullText && { fullText }) }
}

/** A yes/no answer, null when the text doesn't say enough, with how sure Jev is. */
export type YesNo = { answer: boolean | null; confidence: number }

// Screening's own rule: when the text is ambiguous, the answer is unclear rather than a guess.
const YES_NO_CRITERIA = {
  yes: 'The text clearly shows the answer is yes.',
  no: 'The text clearly shows the answer is no.',
  unclear: 'The text does not say enough to answer, or is ambiguous.',
}

type ChoiceAnswer = { type: 'choice'; choice: string; confidence?: number; probabilities?: Record<string, number> }
type DecisionsResponse = {
  answers: Record<string, ChoiceAnswer | { type: string }>
  usage: { input_tokens: number; output_tokens: number; cost?: number }
}

/** Ask Jev yes/no questions about one text in one call; answers come back in question order. */
export async function decideYesNo({
  apiKey,
  model,
  state,
  questions,
  sessionId,
  signal,
}: {
  apiKey: string
  model: string
  /** What Jev reads: the paper's title, abstract and any full text. */
  state: Record<string, unknown>
  questions: string[]
  sessionId?: string
  signal?: AbortSignal
}): Promise<{ answers: YesNo[]; usage: Usage }> {
  const response = await fetch(DECISIONS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'OpenScholar' },
    body: JSON.stringify({
      model,
      state,
      questions: Object.fromEntries(
        questions.map((instructions, i) => [`q${i}`, { type: 'choice', instructions, criteria: YES_NO_CRITERIA }]),
      ),
      ...(sessionId && { session_id: sessionId.slice(0, 256) }),
    }),
    // A stalled call must not hold a batch or its credit reservation open.
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new DecisionsError(response.status, (await response.text().catch(() => '')).slice(0, 500))
  }
  const data = (await response.json()) as DecisionsResponse
  const answers = questions.map((_, i): YesNo => {
    const answer = data.answers?.[`q${i}`]
    // Only Jev's own "unclear" means unclear; a missing or odd answer is a failed call, not a billed null.
    if (!answer || answer.type !== 'choice' || !(((answer as ChoiceAnswer).choice) in YES_NO_CRITERIA)) {
      throw new DecisionsError(502, `no usable answer for question ${i + 1}: ${JSON.stringify(answer ?? null).slice(0, 200)}`)
    }
    const { choice, probabilities } = answer as ChoiceAnswer
    return {
      answer: choice === 'yes' ? true : choice === 'no' ? false : null,
      confidence: probabilities?.[choice] ?? (answer as ChoiceAnswer).confidence ?? 0,
    }
  })
  return {
    answers,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      ...(typeof data.usage.cost === 'number' && { costUsd: data.usage.cost }),
    },
  }
}
