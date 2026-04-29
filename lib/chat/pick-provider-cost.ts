/**
 * Read OpenRouter's all-in USD cost off the AI SDK providerMetadata
 * surfaced from `streamText`'s onFinish callback. The OpenRouter chat
 * factory only emits this when constructed with `usage: { include: true }`
 * (see node_modules/@openrouter/ai-sdk-provider/dist/index.mjs around
 * line 3555 for the request-side wiring and 3900-3902 for the
 * stream-side capture). The number is the markup-free upstream cost
 * including any provider-side tool charges (e.g. server web search).
 *
 * Returns `null` for every shape that is not a finite, non-negative
 * number under `openrouter.usage.cost` so the caller can fall back to
 * the existing token-based math without a second guard.
 */
export function pickProviderCostUsd(providerMetadata: unknown): number | null {
  if (providerMetadata === null || typeof providerMetadata !== "object") {
    return null;
  }
  const openrouter = (providerMetadata as Record<string, unknown>).openrouter;
  if (openrouter === null || typeof openrouter !== "object") {
    return null;
  }
  const usage = (openrouter as Record<string, unknown>).usage;
  if (usage === null || typeof usage !== "object") {
    return null;
  }
  const cost = (usage as Record<string, unknown>).cost;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
    return null;
  }
  return cost;
}
