'use client'

import { useCallback } from 'react'
import { writeFreeQuery } from '@/app/actions/free-queries'
import { useFeatureFlag } from '@/lib/feature-flags/hook'
import { AIError } from '@/lib/ai/core/errors'
import { FREE_QUESTIONS_FLAG } from '@/lib/ai/free-queries'
import { resolveErrorCode } from './mode-routing'
import { useEnhanceSearchQuery } from './router'

/**
 * Why a paid call ran no AI, or ran it on a key that failed: then the free writing takes over. A
 * model failing on credits isn't here: the hold is released, nothing is charged, and it says so.
 */
const CANNOT_PAY = new Set([
  'AI_API_KEY_REQUIRED',
  'AI_KEY_ERROR',
  'AI_KEY_UNREACHABLE',
  'AI_INSUFFICIENT_CREDITS',
  'INSUFFICIENT_CREDITS',
  'AI_CREDITS_DISABLED',
  'AI_UNAUTHENTICATED',
  'BILLING_NETWORK_ERROR',
])

/**
 * Writes a search query from a research question: on the person's own key or credits and their
 * model choice when they can pay, otherwise free (lib/ai/free-queries.ts).
 */
export function useQuestionToQuery() {
  const { execute, isReady, isConfigured } = useEnhanceSearchQuery()
  const free = useFeatureFlag(FREE_QUESTIONS_FLAG)

  const write = useCallback(
    async ({ question, language, syntax }: { question: string; language?: string; syntax?: 'oql' }): Promise<string> => {
      try {
        const result = await execute({ query: question, language, syntax, task: 'questionToQuery' })
        return result.enhancedQuery
      } catch (error) {
        if (!free || !CANNOT_PAY.has(resolveErrorCode(error) ?? '')) throw error
        console.warn('[question-query] writing it free, the paid call could not run:', error)
        const answer = await writeFreeQuery({ question, language, syntax })
        if (answer.ok) return answer.query
        if (answer.reason === 'off') throw error
        if (answer.reason === 'limit') throw new AIError('Free question limit reached', 'AI_FREE_LIMIT')
        if (answer.reason === 'limitSignedOut') throw new AIError('Free question limit reached', 'AI_FREE_LIMIT_SIGNED_OUT')
        throw new Error('The query could not be written')
      }
    },
    [execute, free],
  )

  return { write, isReady, isConfigured: isConfigured || free }
}
