import { z } from 'zod'
import {
  queryEnhancementSchema,
  screeningQuestionsSchema,
  extractionQuestionsSchema,
  createScreeningResponsesSchema,
  translateQuerySchema,
  translatePaperContentSchema,
  buildEnhanceQueryPrompts,
  buildScreeningQuestionsPrompts,
  buildExtractionQuestionsPrompts,
  buildTranslateQueryPrompts,
  buildTranslatePaperContentPrompts,
  buildScreeningResponsesPrompts,
  validateOqlQuery,
  validateQuery,
} from './index'
import {
  EnhanceSearchQueryInput,
  GenerateScreeningQuestionsInput,
  GenerateExtractionQuestionsInput,
  TranslateQueryInput,
  TranslatePaperContentInput,
  GenerateScreeningResponsesInput,
} from './types'
import type { RepairStrategy } from './execute'

// Define the partial config type (everything except 'model')
export interface OperationConfig<TInput, TOutput> {
  schema: z.ZodSchema<TOutput> | z.ZodType<TOutput>
  buildPrompts: (input: TInput, retryCount: number) => { system: string; prompt: string }
  input: TInput
  repairStrategy: RepairStrategy
  temperature: number
  retryConfig?: {
    maxRetries: number
    shouldRetry: (error: Error, attempt: number) => boolean
    onRetry?: (error: Error, attempt: number) => void
  }
  validator?: (output: TOutput) => TOutput
  postProcess?: (output: TOutput, input: TInput) => any
}

// A query-validation error worth re-prompting on (vs a hard failure).
const isRetryableQueryError = (error: Error): boolean =>
  error.message.includes('unbalanced parentheses') ||
  error.message.includes('incomplete operator') ||
  error.message.includes('wildcard')

export function getEnhanceQueryConfig(
  input: EnhanceSearchQueryInput
): OperationConfig<EnhanceSearchQueryInput, z.infer<typeof queryEnhancementSchema>> {
  return {
    schema: queryEnhancementSchema,
    buildPrompts: (input, retryCount) => buildEnhanceQueryPrompts(input, retryCount),
    input,
    repairStrategy: { type: 'single-field', fieldName: 'enhancedQuery' },
    temperature: 1,
    retryConfig: {
      maxRetries: 10,
      shouldRetry: (error) => isRetryableQueryError(error),
      onRetry: (error, attempt) => {
        console.warn(`Query validation failed (attempt ${attempt}/10):`, error)
      },
    },
    validator: (output) => ({
      ...output,
      enhancedQuery: input.syntax === 'oql' ? validateOqlQuery(output.enhancedQuery) : validateQuery(output.enhancedQuery),
    }),
  }
}

export function getScreeningQuestionsConfig(
  input: GenerateScreeningQuestionsInput
): OperationConfig<GenerateScreeningQuestionsInput, z.infer<typeof screeningQuestionsSchema>> {
  return {
    schema: screeningQuestionsSchema,
    buildPrompts: (input) => buildScreeningQuestionsPrompts(input),
    input,
    repairStrategy: { type: 'full-json' },
    temperature: 0.7,
    postProcess: (output, input) => {
      const newQuestions = output.questions.filter((newQuestion: string) => {
        const normalizedNew = newQuestion.toLowerCase().trim()
        return !input.existingQuestions.some((existingQuestion: string) => {
          const normalizedExisting = existingQuestion.toLowerCase().trim()
          return (
            normalizedExisting === normalizedNew ||
            normalizedExisting.includes(normalizedNew) ||
            normalizedNew.includes(normalizedExisting)
          )
        })
      })
      return { questions: newQuestions }
    },
  }
}

export function getExtractionQuestionsConfig(
  input: GenerateExtractionQuestionsInput
): OperationConfig<GenerateExtractionQuestionsInput, z.infer<typeof extractionQuestionsSchema>> {
  return {
    schema: extractionQuestionsSchema,
    buildPrompts: (input) => buildExtractionQuestionsPrompts(input),
    input,
    repairStrategy: { type: 'full-json' },
    temperature: 0.7,
    postProcess: (output, input) => {
      const newQuestions = output.questions.filter((newQ) => {
        const normalizedNew = newQ.question.toLowerCase().trim()
        return !input.existingQuestions.some((existingQuestion: string) => {
          const normalizedExisting = existingQuestion.toLowerCase().trim()
          return (
            normalizedExisting === normalizedNew ||
            normalizedExisting.includes(normalizedNew) ||
            normalizedNew.includes(normalizedExisting)
          )
        })
      })
      return { questions: newQuestions }
    },
  }
}

export function getTranslateQueryConfig(
  input: TranslateQueryInput
): OperationConfig<TranslateQueryInput, z.infer<typeof translateQuerySchema>> {
  return {
    schema: translateQuerySchema,
    buildPrompts: (input) => buildTranslateQueryPrompts(input),
    input,
    repairStrategy: { type: 'single-field', fieldName: 'translatedQuery' },
    temperature: 0.3,
    retryConfig: {
      maxRetries: 5,
      shouldRetry: (error) => isRetryableQueryError(error),
      onRetry: (error, attempt) => {
        console.warn(`Translate validation failed (attempt ${attempt}/5):`, error)
      },
    },
    // Same guard as the enhance op — a wildcard inside a quoted phrase (or other
    // invalid query shape) fails validation and re-prompts the translator.
    validator: (output) => ({
      ...output,
      translatedQuery: input.syntax === 'oql' ? validateOqlQuery(output.translatedQuery) : validateQuery(output.translatedQuery),
    }),
  }
}

export function getTranslatePaperContentConfig(
  input: TranslatePaperContentInput
): OperationConfig<TranslatePaperContentInput, z.infer<typeof translatePaperContentSchema>> {
  return {
    schema: translatePaperContentSchema,
    buildPrompts: (input) => buildTranslatePaperContentPrompts(input),
    input,
    repairStrategy: { type: 'full-json' },
    temperature: 0.3,
  }
}

export function getScreeningResponsesConfig(
  input: GenerateScreeningResponsesInput
): OperationConfig<GenerateScreeningResponsesInput, any> {
  const schema = createScreeningResponsesSchema(input.questions)
  return {
    schema,
    buildPrompts: (input) => buildScreeningResponsesPrompts(input),
    input,
    repairStrategy: { type: 'full-json' },
    temperature: 0.1,
  }
}
