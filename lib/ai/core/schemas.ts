import { z } from 'zod'
import { languageOptions } from './languages'

export const queryEnhancementSchema = z.object({
  enhancedQuery: z
    .string()
    .describe(
      'A complete, syntactically valid Elasticsearch Boolean query string. Must have balanced parentheses and no unfinished groups.'
    ),
})

export const screeningQuestionsSchema = z.object({
  questions: z
    .array(z.string())
    .min(1)
    .max(10)
    .describe(
      'An array of 3-5 screening questions that are specific, answerable with yes/no, and help determine if a paper meets inclusion criteria.'
    ),
})

export function createScreeningResponsesSchema(questions: string[]) {
  const responseProperties: Record<string, any> = {}

  for (const question of questions) {
    responseProperties[question] = z.union([z.boolean(), z.null()]).describe(
      `Response to: "${question}" (true=yes, false=no, null=unclear)`
    )
  }

  return z.object({
    responses: z.object(responseProperties).describe(
      'An object where keys are screening questions and values are boolean responses (true=yes, false=no, null=unclear)'
    ),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .describe('Overall confidence level in the screening results (0-1)'),
  })
}

export const translateQuerySchema = z.object({
  translatedQuery: z.string().describe('The query translated to the target language, maintaining the same meaning and structure'),
})

export const translatePaperContentSchema = z.object({
  translatedTitle: z.string().describe('The paper title translated to English'),
  translatedAbstract: z.string().describe('The paper abstract translated to English'),
})

// Source citation schema for extraction results
export const extractionSourceSchema = z.object({
  quote: z.string().describe('Exact text quoted from the source (max ~200 chars)'),
  location: z.string().describe('The [SOURCE: ...] marker copied from the input'),
})

export const extractDataSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).describe('The extracted value'),
  confidence: z.number().min(0).max(1).describe('Confidence in the extraction (0-1)'),
  reasoning: z.string().describe('Brief explanation for the extraction'),
  sources: z.array(extractionSourceSchema).optional().describe('Citation sources with quotes and locations'),
})

export const STANDARD_PROVIDER_OPTIONS = {
  google: {
    thinkingConfig: {
      thinkingBudget: 0,
    },
  },
  openai: {
    reasoningEffort: 'minimal' as const,
  },
} as const