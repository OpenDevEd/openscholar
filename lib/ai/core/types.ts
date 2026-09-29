import type { SearchTask } from '../tasks'
export type AIOperationType =
  | 'enhanceSearchQuery'
  | 'generateScreeningQuestions'
  | 'generateExtractionQuestions'
  | 'translateQuery'
  | 'translatePaperContent'
  | 'generateScreeningResponses'

/** The query language a search is written in: OpenAlex Query Language, or classic keywords when unset. */
export type QuerySyntax = 'oql'

export interface EnhanceSearchQueryInput {
  query: string
  language?: string
  syntax?: QuerySyntax
  /** Which search task this is; on credits, each can run on its own model. */
  task?: SearchTask
}

export interface EnhanceSearchQueryOutput {
  enhancedQuery: string
  explanation: string
}

export interface GenerateScreeningQuestionsInput {
  researchQuestion: string
  existingQuestions: string[]
  responseLanguage?: string
}

export interface GenerateScreeningQuestionsOutput {
  questions: string[]
}

export interface TranslateQueryInput {
  query: string
  targetLanguage: string
  syntax?: QuerySyntax
}

export interface TranslateQueryOutput {
  translatedQuery: string
}

export interface TranslatePaperContentInput {
  title: string
  abstract: string
  targetLanguage?: string
}

export interface TranslatePaperContentOutput {
  translatedTitle: string
  translatedAbstract: string
  noTranslationNeeded: boolean
}

export interface GenerateScreeningResponsesInput {
  title: string
  abstract: string
  questions: string[]
}

export interface GenerateScreeningResponsesOutput {
  responses: Record<string, boolean | null>
  confidence: number
}

export interface AIProviderConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'openrouter'
  model: string
  apiKey?: string
}

export interface Pricing {
  input: number
  output: number
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

export interface GenerateExtractionQuestionsOutput {
  questions: Array<{
    question: string;
    type: "string" | "boolean" | "number" | "array";
    description?: string;
  }>;
}

// AI types only - extraction removed
