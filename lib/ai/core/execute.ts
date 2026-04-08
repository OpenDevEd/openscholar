import { generateText, Output, type LanguageModel } from 'ai'
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

      const repairToolCall: Parameters<typeof generateText>[0]['experimental_repairToolCall'] =
        async ({ toolCall, error }) => {
          // v6: toolCall.input is already a stringified JSON string
          const rawInput = toolCall.input
          const errorMsg = error instanceof Error ? error.message : String(error)

          let repaired: string | null
          if (repairStrategy.type === 'single-field' && repairStrategy.fieldName) {
            repaired = await repairSingleField(rawInput, errorMsg, repairStrategy.fieldName)
          } else {
            repaired = await repairJSON(rawInput, errorMsg)
          }

          if (repaired === null) return null
          return { ...toolCall, input: repaired }
        }

      const result = await generateText({
        model,
        output: Output.object({ schema }),
        experimental_repairToolCall: repairToolCall,
        providerOptions: STANDARD_PROVIDER_OPTIONS as unknown as Parameters<typeof generateText>[0]['providerOptions'],
        temperature,
        system: prompts.system,
        prompt: prompts.prompt,
      })

      const { output: object, usage } = result

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
