# 02 — Billing: prefer `providerMetadata.openrouter.usage.cost` on the happy path

## Goal

Make the happy-path chat billing read the all-in USD cost from `providerMetadata.openrouter.usage.cost` (which already includes web-search tool cost) and prefer it over the existing token-based math. Without this change, the OpenRouter server-tool path (plan 04) and the abort-path's tool cost would be undercounted on the happy SDK-usage path.

The abort fallback (`settleGenerationUsage` → `/api/v1/generation` `total_cost`) is already correct; this plan does not touch it.

## Scope

In:
- `convex/chat/agent.ts`: pass `usage: { include: true }` on the OpenRouter chat model factory so OpenRouter ships `usage.cost` in the SSE stream and final response. Verified at `node_modules/@openrouter/ai-sdk-provider/dist/index.d.ts:393-398` and `dist/index.mjs:3805`.
- New pure helper `lib/chat/pick-provider-cost.ts`: `pickProviderCostUsd(providerMetadata): number | null`.
- New pure helper `lib/chat/pick-provider-cost.test.ts`: TDD coverage.
- `convex/chat/messages.ts`: `onFinish` extracts `providerMetadata` (currently destructures only `usage`), passes the optional `totalCostUsd` to billing.
- `convex/chat/billing.ts`: extend `billGenerationFromSdkUsage` and `billThreadUsageFromSdk` argument validators with `totalCostUsd: v.optional(v.number())`. When present and >= 0, deduct via `convertUsdCostToCredits(totalCostUsd)` and skip the token-based `calculateCreditsToDeductFromUsage` math; persist the cost on the `chatGenerationUsages.totalCostUsd` column. When absent, fall back to today's behavior.
- Update `buildChatBillingMetadata` to record `billingSource: "sdk_usage_cost"` when the cost was sourced from `providerMetadata`.

Out:
- Tavily-specific cost capture (plan 05).
- Model `webSearchPrice` reads (cost is a single all-in USD number from OpenRouter — no per-tool decomposition).
- Pre-flight floor adjustment (`ESTIMATED_CREDITS_PER_CHAT_MESSAGE`) — not strictly required for correctness; if needed, raise in plan 06.

## Design

OpenRouter sends `usage.cost` only when the model factory has `usage: { include: true }` (provider source `dist/index.mjs:3805`). We set it once on the default model factory at `convex/chat/agent.ts` and on the per-call factory in `convex/chat/provider.ts:resolveOpenRouterModel`. Both pass through the same model creation path.

Once the setting is in place, the AI SDK `onFinish` callback's `event` arg includes `providerMetadata?.openrouter?.usage?.cost`. We extract it via the new helper and forward it to billing.

### Helper contract

```ts
// lib/chat/pick-provider-cost.ts
export function pickProviderCostUsd(providerMetadata: unknown): number | null {
  if (!providerMetadata || typeof providerMetadata !== "object") return null;
  const openrouter = (providerMetadata as Record<string, unknown>).openrouter;
  if (!openrouter || typeof openrouter !== "object") return null;
  const usage = (openrouter as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return null;
  const cost = (usage as Record<string, unknown>).cost;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return null;
  return cost;
}
```

### `billGenerationFromSdkUsage` extension

Current behavior at `convex/chat/billing.ts:333-412` computes `billedCredits = calculateCreditsToDeductFromUsage({ usage, pricing })` from token counts. Extension:

```ts
const billedCredits = args.totalCostUsd != null
  ? convertUsdCostToCredits(args.totalCostUsd)
  : calculateCreditsToDeductFromUsage({ usage: { ... }, pricing: args.pricing });
```

`convertUsdCostToCredits` already applies `AI_COST_MARKUP = 1.3` and the credits-per-USD rate. Same path the abort fallback uses (`settleGenerationUsage` at `billing.ts:538`). Symmetry by design.

### Metadata

`buildChatBillingMetadata` at `convex/chat/openrouterFetch.ts:129` accepts a `billingSource: "sdk_usage" | "openrouter_generation_api"` discriminator. Add a third `"sdk_usage_cost"` (or `"sdk_usage_with_cost"` — pick one in implementation) so the ledger row distinguishes happy-path cost-readback from happy-path token-based fallback. Persist `totalCostUsd` and the SDK-reported cost-detail breakdown if present.

### `chatGenerationUsages` column

`totalCostUsd` already exists on the row (used by the abort path). Reuse it. No schema change.

## TDD sequence

Phase A — pure logic (one commit per green):

R1 — RED: `pick-provider-cost.test.ts` cases:
- `null`, `undefined`, `{}`, `{openrouter:null}` → `null`
- `{openrouter:{}}` → `null`
- `{openrouter:{usage:{}}}` → `null`
- `{openrouter:{usage:{cost:0}}}` → `0`
- `{openrouter:{usage:{cost:0.0034}}}` → `0.0034`
- `{openrouter:{usage:{cost:-1}}}` → `null`
- `{openrouter:{usage:{cost:NaN}}}` → `null`
- `{openrouter:{usage:{cost:"0.01"}}}` (wrong type) → `null`

G1 — GREEN: implement `pickProviderCostUsd`. Commit `test(chat): [plan-02] pickProviderCostUsd cases` then `feat(chat): [plan-02] pickProviderCostUsd helper`.

R2 — RED: extend `convex/chat/billing.test.ts` (or its integration cousin) with cases:
- `billGenerationFromSdkUsage({ totalCostUsd: 0.05, ... })` → bills via `convertUsdCostToCredits(0.05)`, ignores `calculateCreditsToDeductFromUsage`. Ledger row metadata.billingSource = `"sdk_usage_cost"`.
- `billGenerationFromSdkUsage({ totalCostUsd: undefined, ... })` → bills via the existing token math, metadata.billingSource = `"sdk_usage"`.
- `billGenerationFromSdkUsage({ totalCostUsd: 0, ... })` → no deduction (zero credits), no transaction row.
- Idempotency: calling twice with same generationId only bills once.

G2 — GREEN: implement the conditional. Commit each test→pass cycle separately.

Phase B — call-site wiring (one commit per logical unit):

U1 — `convex/chat/agent.ts`: pass `usage: { include: true }` on `openrouter.chat(defaultModelId, { usage: { include: true } })`.
U2 — `convex/chat/provider.ts:resolveOpenRouterModel`: same — confirm both factories carry the setting.
U3 — `convex/chat/messages.ts:409-471`: change destructure to `({ usage, providerMetadata })`; call `pickProviderCostUsd(providerMetadata)`; forward as `totalCostUsd?` to both billing branches (`billGenerationFromSdkUsage` AND `billThreadUsageFromSdk`).
U4 — `convex/chat/billing.ts`: extend the validators of both internal mutations with `totalCostUsd: v.optional(v.number())`; implement the cost-source switch.

Each U-step is one commit: `feat(chat): [plan-02] enable usage.include on chat model factory`, `feat(chat): [plan-02] pass providerMetadata cost into billing`, `feat(chat): [plan-02] prefer SDK-reported cost when present`.

## Files touched

- `convex/chat/agent.ts` (≤ 5 LOC)
- `convex/chat/provider.ts` (≤ 5 LOC, in `resolveOpenRouterModel`)
- `convex/chat/messages.ts:409-471` (~ 10 LOC)
- `convex/chat/billing.ts:333-412` (~ 30 LOC)
- `convex/chat/billing.ts:415-503` (`billThreadUsageFromSdk` — symmetric extension)
- `convex/chat/openrouterFetch.ts:129-163` (`buildChatBillingMetadata` — new discriminator)
- `lib/chat/pick-provider-cost.ts` (new, ~ 15 LOC)
- `lib/chat/pick-provider-cost.test.ts` (new, ~ 40 LOC)
- `convex/chat/billing.test.ts` or `convex/chat/billing.integration.test.ts` (extend existing, ~ 60 LOC)

## Migration stance

None — additive optional argument and additive ledger metadata discriminator. Existing rows and existing test fixtures continue to validate.

## Test plan

- Vitest unit for the helper.
- Convex integration test for both billing mutations covering: cost-supplied path, cost-omitted fallback, idempotency, zero-cost no-op.
- Manual smoke: send one chat message in dev with the toggle off (web search not yet wired); confirm in the Convex dashboard the `chatGenerationUsages` row has `totalCostUsd` populated and `billingSource = "sdk_usage_cost"`.

## Acceptance criteria

- [ ] `pickProviderCostUsd` exists; all unit cases pass.
- [ ] Both chat model factories pass `usage: { include: true }`.
- [ ] `onFinish` reads `providerMetadata` and forwards `totalCostUsd` into both billing branches.
- [ ] `billGenerationFromSdkUsage` and `billThreadUsageFromSdk` accept and prefer `totalCostUsd` when finite and ≥ 0.
- [ ] When `totalCostUsd` is absent, both fall back to the existing token-based calc (regression-tested).
- [ ] Ledger metadata `billingSource = "sdk_usage_cost"` for the new path.
- [ ] No double-billing on retry — idempotent guard preserved (`row.billedAt`).
- [ ] `tsc --noEmit` clean. Existing tests pass.

## Known pitfalls

- **Do not** swap `calculateCreditsToDeductFromUsage` removal for the cost-readback. Keep the fallback — there are still response shapes and provider configs where `cost` is `null` (e.g. when OpenRouter is in a degraded mode).
- **Do not** apply `AI_COST_MARKUP` twice. `convertUsdCostToCredits` already includes it. The token-based path also already includes it. Symmetry must be preserved.
- **Do not** assume `providerMetadata` is always shaped as `{ openrouter: { usage: { cost } } }`. The helper guards every layer; do not inline the lookup elsewhere.
- **Do not** forget the second factory in `provider.ts`. The default factory in `agent.ts` is the fallback; the per-request factory is what most calls actually use. Both need `usage: { include: true }` or you'll see undefined `cost` at runtime.
- **Beware of cancelled streams**: when the stream aborts, `onFinish` does NOT fire (per `convex/chat/openrouterFetch.ts:13-15` comment), so the abort fallback path is the cost source. Already correct — do not duplicate logic.
- **`billThreadUsageFromSdk` defence-in-depth**: the existing comment notes "fetch wrapper missed the header but the stream still finished." `totalCostUsd` is still meaningful here; do not gate it on `capturedGenerationId`.
