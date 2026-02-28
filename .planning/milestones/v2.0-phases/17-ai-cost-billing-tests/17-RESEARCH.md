# Phase 17: AI Cost & Billing Tests - Research

**Researched:** 2026-02-28
**Domain:** AI cost calculation, usage aggregation, model registry
**Confidence:** HIGH

## Summary

Phase 17 tests pure functions in two modules: `lib/ai/core/cost.ts` (cost calculation, usage aggregation) and `lib/ai-models.ts` (model registry, pricing lookup). All target functions are synchronous, pure, and require zero mocking -- making this a straightforward unit testing phase.

The modules are small and well-contained. `cost.ts` exports two functions (`calculateCostInDollars`, `aggregateUsage`) and `ai-models.ts` exports four relevant functions (`getModelPricing`, `getModelById`, `getModelsForProvider`, `getDefaultModelForProvider`). No external dependencies, no async operations, no side effects.

**Primary recommendation:** Test directly against the exported functions with no mocking. Use `it.each` for provider/model parametric coverage. Group tests into two files matching the two source modules.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all decisions are at Claude's discretion.

### Claude's Discretion
- Test data construction for provider-specific pricing models
- How to verify cost calculation precision (floating point handling)
- How to test all known models without brittle coupling to the model list
- Test organization (one file per module vs grouped by concern)
- Edge case selection for aggregateUsage (empty array, single item, large numbers)
- How to handle unknown model/provider graceful degradation testing

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AICB-01 | `calculateCostInDollars` returns correct cost for each provider's pricing model (OpenAI, Anthropic, Google, DeepSeek) | Direct testing of `lib/ai/core/cost.ts` -- pure function with provider/model/usage inputs, no mocking needed |
| AICB-02 | `aggregateUsage` correctly sums token counts across multiple usage objects including edge cases | Direct testing of `lib/ai/core/cost.ts` -- reduce-based aggregation over Usage arrays |
| AICB-03 | `getModelPricing` returns `{0, 0}` for unknown models and correct pricing for known models | Direct testing of `lib/ai-models.ts` -- lookup function with fallback behavior |
| AICB-04 | `getModelById`, `getModelsForProvider`, `getDefaultModelForProvider` return correct model configs and handle missing/unknown inputs gracefully | Direct testing of `lib/ai-models.ts` -- registry lookup functions |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (project version) | Test runner | Already configured in vitest.config.ts with node environment |

### Supporting
No additional libraries needed. All target functions are pure and synchronous.

### Alternatives Considered
None -- no new dependencies required for this phase.

## Architecture Patterns

### Recommended Test Structure
```
tests/
├── ai-cost.test.ts        # calculateCostInDollars, aggregateUsage (AICB-01, AICB-02)
└── ai-models.test.ts      # getModelPricing, getModelById, getModelsForProvider, getDefaultModelForProvider (AICB-03, AICB-04)
```

### Pattern 1: Parametric Provider Coverage with it.each
**What:** Use `it.each` to test the same behavior across all 4 providers without duplicating test logic.
**When to use:** When the same function must produce correct output for multiple provider/model combinations.
**Example:**
```typescript
const providerCases = [
  { provider: 'openai' as const, modelId: 'gpt-5-mini', input: 0.05, output: 0.40 },
  { provider: 'anthropic' as const, modelId: 'claude-3-haiku', input: 0.25, output: 1.25 },
  { provider: 'google' as const, modelId: 'gemini-2.0-flash', input: 0.10, output: 0.40 },
  { provider: 'deepseek' as const, modelId: 'deepseek-chat', input: 0.14, output: 0.28 },
];

it.each(providerCases)(
  'returns correct cost for $provider / $modelId',
  ({ provider, modelId, input, output }) => {
    const usage = { promptTokens: 1_000_000, completionTokens: 1_000_000 };
    const cost = calculateCostInDollars(usage, provider, modelId);
    expect(cost).toBeCloseTo(input + output, 6);
  }
);
```

### Pattern 2: Snapshot-Free Pricing Verification
**What:** Test known models by picking one representative per provider and hardcoding expected pricing. Avoids brittle snapshot of all 40+ models.
**When to use:** When testing pricing correctness without coupling to the full model list.
**Why:** The model list changes frequently (new models added). Tests should verify behavior (correct lookup, correct math) not freeze the model catalog.

### Pattern 3: Boundary Behavior for Unknown Inputs
**What:** Test that unknown providers/models return graceful defaults ({0, 0} pricing, undefined model).
**Example:**
```typescript
it('returns zero pricing for unknown model', () => {
  const pricing = getModelPricing('openai', 'nonexistent-model');
  expect(pricing).toEqual({ input: 0, output: 0 });
});
```

### Anti-Patterns to Avoid
- **Snapshot all model data:** The model registry has 40+ models. Snapshot tests would break on every model addition. Test representative samples instead.
- **Testing internal module structure:** Don't test `OPENAI_MODELS` array directly -- test through public API (`getModelById`, `getModelsForProvider`).
- **Floating point exact equality:** Use `toBeCloseTo` for cost calculations, not `toBe`. Cost math involves division by 1,000,000 which can produce floating-point artifacts.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Floating point comparison | Manual epsilon checks | `expect(x).toBeCloseTo(y, 6)` | Vitest handles precision correctly |
| Provider iteration | Manual loops with assertions | `it.each([...])` | Better test names, clearer failure messages |

## Common Pitfalls

### Pitfall 1: Floating-Point Precision in Cost Calculation
**What goes wrong:** `(tokens / 1_000_000) * price` can produce values like `0.25000000000000003` instead of `0.25`.
**Why it happens:** IEEE 754 floating-point arithmetic.
**How to avoid:** Use `toBeCloseTo(expected, 6)` for all cost assertions. 6 decimal places is sufficient for dollar amounts.
**Warning signs:** Tests passing locally but failing in CI due to platform-specific float behavior.

### Pitfall 2: Usage Object Field Aliasing
**What goes wrong:** The Usage type has both `promptTokens` and `inputTokens` (and `completionTokens`/`outputTokens`). Tests might only check one alias.
**Why it happens:** `calculateCostInDollars` uses `usage.promptTokens ?? usage.inputTokens ?? 0` -- it prefers `promptTokens` but falls back to `inputTokens`.
**How to avoid:** Test with both field names to verify the fallback chain works correctly.
**Warning signs:** Tests pass with `promptTokens` but the actual AI SDK returns `inputTokens`.

### Pitfall 3: OpenRouter and Azure Special Cases
**What goes wrong:** `getModelPricing('openrouter', ...)` always returns `{0, 0}` because OpenRouter has dynamic pricing. Azure has an empty model list. Tests might miss these edge cases.
**Why it happens:** OpenRouter and Azure are "passthrough" providers -- pricing isn't known at compile time.
**How to avoid:** Explicitly test these providers and verify they return zero pricing / empty model lists / undefined model lookups.

### Pitfall 4: aggregateUsage with Empty Array
**What goes wrong:** `[].reduce()` without an initial value throws. The implementation provides an initial value, but tests should verify this.
**Why it happens:** Edge case in reduce-based aggregation.
**How to avoid:** Include an empty-array test case.

## Code Examples

### calculateCostInDollars - Core Formula
```typescript
// Source: lib/ai/core/cost.ts lines 5-18
// formula: (promptTokens / 1M * input_price) + (completionTokens / 1M * output_price)
// For gpt-5-mini: $0.05/1M input, $0.40/1M output
// 500K prompt + 200K completion = (0.5 * 0.05) + (0.2 * 0.40) = 0.025 + 0.08 = 0.105
```

### aggregateUsage - Reduce Pattern
```typescript
// Source: lib/ai/core/cost.ts lines 25-35
// Sums all four fields: promptTokens, inputTokens, completionTokens, outputTokens
// Initial accumulator: { promptTokens: 0, inputTokens: 0, completionTokens: 0, outputTokens: 0 }
```

### getModelById - Lookup with Provider Guard
```typescript
// Source: lib/ai-models.ts lines 427-433
// Returns undefined for openrouter (no static model list)
// For other providers: finds model by id in provider's model array
```

## State of the Art

No recent changes affect this phase. The modules under test are stable utility functions that have not changed recently.

## Open Questions

None. All functions are well-documented, pure, and have clear contracts.

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `lib/ai/core/cost.ts`, `lib/ai-models.ts`, `lib/ai/core/types.ts`, `lib/types/ai.types.ts`
- Existing test patterns: `tests/ai-batch.test.ts`, `tests/ai-credit-billing.test.ts`
- Vitest configuration: `vitest.config.ts`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - vitest already configured and used extensively
- Architecture: HIGH - pure functions, no complex patterns needed
- Pitfalls: HIGH - float precision and field aliasing are well-known concerns

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable utility modules, unlikely to change)
