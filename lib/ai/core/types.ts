export type AIOperationType =
  | 'enhanceSearchQuery'
  | 'generateScreeningQuestions'
  | 'generateExtractionQuestions'
  | 'translateQuery'
  | 'translatePaperContent'
  | 'generateScreeningResponses'

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
  sourceLanguage: string
  targetLanguage?: string
}

export interface TranslatePaperContentOutput {
  translatedTitle: string
  translatedAbstract: string
  sourceLanguage: string
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