import { z } from 'zod'
import { languageOptions } from './languages'

export const queryEnhancementSchema = z.object({
  enhancedQuery: z
    .string()
    .describe(
      'A complete, syntactically valid Elasticsearch Boolean query string. Must have balanced parentheses and no unfinished groups. For an OpenAlex Query Language search, an OQL query instead.'
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
  const responseProperties: Record<string, z.ZodTypeAny> = {}

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
  translatedTitle: z.string().describe('The paper title translated to the target language'),
  translatedAbstract: z.string().describe('The paper abstract translated to the target language'),
})

export const extractionQuestionsSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().describe("The data extraction question"),
        type: z.enum(["string", "boolean", "number", "array"]).describe("Expected answer type"),
        description: z.string().nullable().describe("Context or instructions for the AI extractor, or null"),
      })
    )
    .min(1)
    .max(10)
    .describe("3-7 data extraction questions with their expected types"),
})

/** Strict structured output needs every field, so a missing description comes back as null. */
export const toExtractionQuestions = (output: z.infer<typeof extractionQuestionsSchema>) => ({
  questions: output.questions.map(({ description, ...question }) => ({
    ...question,
    ...(description ? { description } : {}),
  })),
})
