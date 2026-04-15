export type AIOperationType =
  | 'enhanceSearchQuery'
  | 'generateScreeningQuestions'
  | 'translateQuery'
  | 'translatePaperContent'
  | 'generateScreeningResponses'
  | 'extractAnswer'

export interface EnhanceSearchQueryInput {
  query: string
  language?: string
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

export interface ExtractionPromptInput {
  bodyText: string
  question: string
  expectedType?: string
}

export interface CriticPromptInput {
  question: string;
  answer: string;
  evidenceQuote: string;
  sourceSlice: string;
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
}

