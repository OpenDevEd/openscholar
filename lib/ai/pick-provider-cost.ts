const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null);

/**
 * What one OpenRouter call cost in USD, from its usage accounting: the raw API's (`cost`, `cost_details`, `is_byok`) or
 * the AI SDK's (`cost`, `costDetails`). `cost` is what OpenRouter charged us. On our own provider key (BYOK) that's only
 * OpenRouter's fee, often 0, and what the provider charged is `upstream_inference_cost`, so the call cost both
 * together. On OpenRouter's own credits `cost` is all of it, and the same figure may also show as the upstream charge,
 * so it's counted once (https://openrouter.ai/docs/use-cases/usage-accounting). The AI SDK drops `is_byok`: then a
 * `cost` below the provider's charge is OpenRouter's fee on our own key, which is never more than a share of it. Null
 * when there's no `cost` to read, so the caller falls back to tokens at the model's price.
 */
export function openRouterUsageCost(usage: unknown): number | null {
  const fields = record(usage);
  if (!fields || !finite(fields.cost)) return null;
  const details = record(fields.costDetails) ?? record(fields.cost_details);
  const upstream = details?.upstreamInferenceCost ?? details?.upstream_inference_cost;
  if (!finite(upstream)) return fields.cost;
  const byok = typeof fields.is_byok === "boolean" ? fields.is_byok : fields.cost < upstream;
  return byok ? fields.cost + upstream : fields.cost;
}

/**
 * What one call cost in USD, off the AI SDK providerMetadata of an OpenRouter call (`streamText`'s steps, `generateText`).
 * The OpenRouter chat factory only reports it when constructed with `usage: { include: true }`. It includes
 * provider-side tool charges, such as server web search. Null when it isn't there.
 */
export function pickProviderCostUsd(providerMetadata: unknown): number | null {
  return openRouterUsageCost(record(record(providerMetadata)?.openrouter)?.usage);
}
