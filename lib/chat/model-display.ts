/**
 * Display helpers for chat model rows. Centralised so the composer
 * picker, the retry tooltip, and any future surface (settings,
 * leaderboards, etc.) all show the model the same way.
 */

/**
 * OpenRouter-sourced rows arrive as "OpenAI: GPT-5.4 Mini". The
 * provider glyph already carries that information visually, so strip
 * the prefix for a cleaner row.
 */
export function stripProviderPrefix(name: string): string {
  const idx = name.indexOf(": ");
  return idx >= 0 ? name.slice(idx + 2) : name;
}
