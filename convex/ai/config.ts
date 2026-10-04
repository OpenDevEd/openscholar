export const SERVER_AI_CONFIG = {
  provider: (process.env.AI_PROVIDER || 'deepseek') as 'deepseek' | 'openai' | 'anthropic' | 'azure' | 'openrouter',
  model: process.env.AI_MODEL || 'deepseek-chat',
  openrouterProviderOrder: process.env.OPENROUTER_PROVIDER_ORDER,
  openrouterAllowFallbacks: process.env.OPENROUTER_ALLOW_FALLBACKS !== 'false',
} as const

/** The model that runs when nothing picks one, as the catalog names it. */
export const SERVER_MODEL_SLUG = SERVER_AI_CONFIG.model.includes("/") ? SERVER_AI_CONFIG.model : `${SERVER_AI_CONFIG.provider}/${SERVER_AI_CONFIG.model}`

