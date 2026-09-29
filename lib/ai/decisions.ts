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

// ponytail: ~4 characters a token keeps Jev's 32K-token context with room for the
// questions and criteria; count tokens exactly if papers start getting refused.
const MAX_STATE_CHARS = 100_000

/**
 * A paper as Jev reads it, within its context: the title and questions always fit,
 * then the abstract, then as much full text as is left.
 */
export function paperState(paper: { title: string; abstract?: string; fullText?: string }, questions: string[]) {
  let room = MAX_STATE_CHARS - paper.title.length - questions.join('').length
  const abstract = paper.abstract?.slice(0, Math.max(0, room))
  room -= abstract?.length ?? 0
  const fullText = paper.fullText?.slice(0, Math.max(0, room))
  return { title: paper.title, ...(abstract && { abstract }), ...(fullText && { fullText }) }
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
    signal,
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
