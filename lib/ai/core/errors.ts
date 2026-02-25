export class AIError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly cause?: Error
  ) {
    super(message)
    this.name = 'AIError'
  }
}

export class AIApiKeyRequiredError extends AIError {
  constructor() {
    super('API key is required for local AI operations', 'AI_API_KEY_REQUIRED')
    this.name = 'AIApiKeyRequiredError'
  }
}

export class AIUnauthenticatedError extends AIError {
  constructor() {
    super('Authentication required to use AI features', 'AI_UNAUTHENTICATED')
    this.name = 'AIUnauthenticatedError'
  }
}

export class AIInsufficientCreditsError extends AIError {
  constructor() {
    super('Insufficient credits for AI operation', 'AI_INSUFFICIENT_CREDITS')
    this.name = 'AIInsufficientCreditsError'
  }
}

export class AIPlanEntitlementError extends AIError {
  constructor(requiredPlan: string = 'Go') {
    super(
      `This feature requires the ${requiredPlan} plan or higher`,
      'AI_PLAN_ENTITLEMENT'
    )
    this.name = 'AIPlanEntitlementError'
  }
}

export class AIValidationError extends AIError {
  constructor(details: string, cause?: Error) {
    super(`AI response failed validation: ${details}`, 'AI_VALIDATION_ERROR', cause)
    this.name = 'AIValidationError'
  }
}

export class AIProviderError extends AIError {
  constructor(details: string, cause?: Error) {
    super(`AI provider error: ${details}`, 'AI_PROVIDER_ERROR', cause)
    this.name = 'AIProviderError'
  }
}

export class AIMaxRetriesExceededError extends AIError {
  constructor(attempts: number, lastError?: Error) {
    super(
      `Failed after ${attempts} retry attempts`,
      'AI_MAX_RETRIES_EXCEEDED',
      lastError
    )
    this.name = 'AIMaxRetriesExceededError'
  }
}

export interface RetryConfig {
  maxRetries: number
  shouldRetry: (error: Error, attempt: number) => boolean
  onRetry?: (error: Error, attempt: number) => void
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 1,
  shouldRetry: () => false,
}

export function handleAIError(error: unknown, context: string): never {
  if (error instanceof AIError) {
    throw error
  }

  if (error instanceof Error) {
    throw new AIProviderError(`${context}: ${error.message}`, error)
  }

  throw new AIProviderError(`${context}: ${String(error)}`)
}
