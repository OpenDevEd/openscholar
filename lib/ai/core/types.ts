export type AIOperationType = 
  | 'enhanceSearchQuery'
  | 'generateScreeningQuestions'
  | 'translateQuery'
  | 'translatePaperContent'
  | 'generateScreeningResponses'
  | 'extractData'

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
}

export interface TranslatePaperContentOutput {
  translatedTitle: string
  translatedAbstract: string
  sourceLanguage: string
  isAlreadyInEnglish: boolean
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

// Data Extraction types
export type ExtractionQuestionType = 'text' | 'number' | 'boolean'

export interface ExtractDataInput {
  title: string
  abstract: string
  question: string
  type: ExtractionQuestionType
}

export interface ExtractDataOutput {
  value: string | number | boolean | null
  confidence: number
  reasoning: string
}