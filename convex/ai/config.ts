export const SERVER_AI_CONFIG = {
  provider: (process.env.AI_PROVIDER || 'deepseek') as 'deepseek' | 'openai' | 'anthropic',
  model: process.env.AI_MODEL || 'deepseek-chat',
} as const
