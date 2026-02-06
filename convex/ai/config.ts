export const SERVER_AI_CONFIG = {
  provider: (process.env.AI_PROVIDER || 'deepseek') as 'deepseek' | 'openai' | 'anthropic' | 'azure' | 'openrouter',
  model: process.env.AI_MODEL || 'deepseek-chat',
  openrouterProviderOrder: process.env.OPENROUTER_PROVIDER_ORDER,
  openrouterAllowFallbacks: process.env.OPENROUTER_ALLOW_FALLBACKS !== 'false',
} as const
