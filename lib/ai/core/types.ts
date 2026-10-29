import type { SearchTask } from '../tasks'
/** The query language a search is written in: OpenAlex Query Language, or classic keywords when unset. */
type QuerySyntax = 'oql'

export interface EnhanceSearchQueryInput {
  query: string
  language?: string
  syntax?: QuerySyntax
  /** Which search task this is; on credits, each can run on its own model. */
  task?: SearchTask
}

export interface SuggestSearchesInput {
  /** The person's recent searches, newest first: each its latest question, or its query. */
  searches: string[]
}

export interface GenerateScreeningQuestionsInput {
  researchQuestion: string
  existingQuestions: string[]
  responseLanguage?: string
}

export interface TranslateQueryInput {
  query: string
  targetLanguage: string
  syntax?: QuerySyntax
}

export interface TranslatePaperContentInput {
  title: string
  abstract: string
  targetLanguage?: string
}

export interface GenerateScreeningResponsesInput {
  title: string
  abstract: string
  questions: string[]
}

export interface Usage {
  promptTokens?: number
  inputTokens?: number
  completionTokens?: number
  outputTokens?: number
  /** Input tokens the provider served from its prompt cache. */
  cacheReadTokens?: number
  /** Input tokens written to the prompt cache. */
  cacheWriteTokens?: number
  /** Output tokens spent reasoning; already counted in the output tokens. */
  reasoningTokens?: number
  /** What OpenRouter reports the call cost, in USD, cache and reasoning included. */
  costUsd?: number
}

export interface GenerateExtractionQuestionsInput {
  jobName: string;
  sourceContext: string;
  existingQuestions: string[];
  responseLanguage?: string;
}

// AI types only - extraction removed
