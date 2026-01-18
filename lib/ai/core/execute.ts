import { generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'
import { STANDARD_PROVIDER_OPTIONS } from './schemas'
import { repairJSON, repairSingleField } from './validate'
import {
  AIValidationError,
  AIMaxRetriesExceededError,
  handleAIError,
  type RetryConfig,
  DEFAULT_RETRY_CONFIG,
} from './errors'
import type { Usage } from './types'

export interface RepairStrategy {
  type: 'single-field' | 'full-json'
  fieldName?: string
}

export interface ExecuteAIOperationConfig<TInput, TOutput> {
  model: LanguageModel
  schema: z.Schema<TOutput>
  buildPrompts: (input: TInput, retryCount: number) => { system: string; prompt: string }
  input: TInput
  repairStrategy: RepairStrategy
  temperature: number
  retryConfig?: RetryConfig
  validator?: (output: TOutput) => TOutput | Promise<TOutput>
  postProcess?: (output: TOutput, input: TInput) => TOutput | Promise<TOutput>
}

export async function executeAIOperation<TInput, TOutput>(
  config: ExecuteAIOperationConfig<TInput, TOutput>
): Promise<{ output: TOutput; usage: Usage }> {
  const {
    model,
    schema,
    buildPrompts,
    input,
    repairStrategy,
    temperature,
    retryConfig = DEFAULT_RETRY_CONFIG,
    validator,
    postProcess,
  } = config

  const { maxRetries, shouldRetry, onRetry } = retryConfig
  let retryCount = 0
  let lastError: Error | null = null

  while (retryCount <= maxRetries) {
    try {
      const prompts = buildPrompts(input, retryCount)

      const repairText = async ({ text, error }: { text: string; error: string }) => {
        if (repairStrategy.type === 'single-field' && repairStrategy.fieldName) {
          return repairSingleField(text, error, repairStrategy.fieldName)
        }
        return repairJSON(text, error)
      }

      const result = await generateObject({
        model,
        schema,
        experimental_repairText: repairText,
        providerOptions: STANDARD_PROVIDER_OPTIONS,
        temperature,
        system: prompts.system,
        prompt: prompts.prompt,
      } as any)
      
      const { object, usage } = result

      let finalOutput = object as TOutput

      if (validator) {
        try {
          finalOutput = await validator(finalOutput)
        } catch (validationError) {
          if (validationError instanceof Error && shouldRetry(validationError, retryCount)) {
            lastError = validationError
            retryCount++
            
            if (onRetry) {
              onRetry(validationError, retryCount)
            }
            
            if (retryCount > maxRetries) {
              throw new AIMaxRetriesExceededError(maxRetries, lastError)
            }
            
            continue
          }
          throw new AIValidationError(validationError instanceof Error ? validationError.message : String(validationError), validationError instanceof Error ? validationError : undefined)
        }
      }

      if (postProcess) {
        finalOutput = await postProcess(finalOutput, input)
      }

      return {
        output: finalOutput,
        usage: usage as Usage,
      }
    } catch (error) {
      if (error instanceof AIValidationError || error instanceof AIMaxRetriesExceededError) {
        throw error
      }

      lastError = error instanceof Error ? error : new Error(String(error))

      if (shouldRetry(lastError, retryCount)) {
        retryCount++
        
        if (onRetry) {
          onRetry(lastError, retryCount)
        }
        
        if (retryCount > maxRetries) {
          throw new AIMaxRetriesExceededError(maxRetries, lastError)
        }
        
        continue
      }

      handleAIError(error, 'AI operation execution failed')
    }
  }

  throw new AIMaxRetriesExceededError(maxRetries, lastError || new Error('Unknown error'))
}
