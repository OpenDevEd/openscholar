const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const record = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null);

/**
 * What one OpenRouter call cost in USD, from its usage accounting: the raw API's (`cost`, `cost_details`) or the AI
 * SDK's (`cost`, `costDetails`). `cost` is what OpenRouter charged us. On our own provider key (BYOK) that's only
 * OpenRouter's fee, often 0, and what the provider charged is `upstream_inference_cost`, so the call cost both
 * together; on OpenRouter's own credits that field is 0 or missing and `cost` is all of it
 * (https://openrouter.ai/docs/use-cases/usage-accounting). Null when there's no `cost` to read, so the caller falls back
 * to tokens at the model's price.
 */
export function openRouterUsageCost(usage: unknown): number | null {
  const fields = record(usage);
  if (!fields || !finite(fields.cost)) return null;
  const details = record(fields.costDetails) ?? record(fields.cost_details);
  const upstream = details?.upstreamInferenceCost ?? details?.upstream_inference_cost;
  return fields.cost + (finite(upstream) ? upstream : 0);
}

/**
 * What one call cost in USD, off the AI SDK providerMetadata of an OpenRouter call (`streamText`'s steps, `generateText`).
 * The OpenRouter chat factory only reports it when constructed with `usage: { include: true }`. It includes
 * provider-side tool charges, such as server web search. Null when it isn't there.
 */
export function pickProviderCostUsd(providerMetadata: unknown): number | null {
  return openRouterUsageCost(record(record(providerMetadata)?.openrouter)?.usage);
}
