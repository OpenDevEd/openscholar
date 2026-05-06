# Plan 02 — Migrate `convex/ai/helpers.ts` wrappers to drain-to-zero

## Goal

Make `withAuthAndCreditsBatch`, `withUserCreditsBatch`, and `withAuthAndCredits` opt into `allowPartial: true` for their **single-call** deduction sites (the post-handler aggregate deduction). Capture `result.deducted` and use it for the in-memory `creditContext` so PostHog tracking reports actual rather than estimated.

## Scope

- `convex/ai/helpers.ts` only.
- Three migrated sites:
  - `withAuthAndCreditsBatch` line ~346 (single deduction when no `usageBreakdown`).
  - `withUserCreditsBatch` line ~436.
  - `withAuthAndCredits` line ~537.
- **Out of scope**: `applyBatchItemDeductions` callback at line ~338. That code path uses an INSUFFICIENT_CREDITS catch-and-salvage mechanism that produces structured per-item errors. Switching to `allowPartial` would silently process exhausted items as `deducted: 0` with no error signal.

## Design

Each migrated site changes from:

```ts
await ctx.runMutation(internal.credits.internal.deductCredits, {
  userId,
  amount: creditsToDeduct,
  description: `AI: ${operation}`,
  // ...billing hints
});
```

to:

```ts
const { deducted } = await ctx.runMutation(
  internal.credits.internal.deductCredits,
  {
    userId,
    amount: creditsToDeduct,
    description: `AI: ${operation}`,
    allowPartial: true,
    // ...billing hints
  },
);
```

For `withUserCreditsBatch` and `withAuthAndCreditsBatch` (single-deduction branch), the existing `creditContext` object is built BEFORE the deduction call (lines 400-405 / 287-298). After the migration the `creditContext` still uses `creditsToDeduct` for tracking — the estimate is what was *intended*, the actual is what was *deducted*. PostHog should track actual:

```ts
// build the tracking context AFTER deduction so creditsRemaining reflects reality
const creditContext = {
  creditsDeducted: deducted,
  creditsRawCost: calculateServerRawCreditCost(totalUsage, pricing),
  creditsRemaining: Math.max(0, balance!.total - deducted),
  lifetimeCreditsUsed: balance!.lifetimeUsed + deducted,
};
```

The `tracking entries` enrichment at lines 301-308 / 408-415 stays untouched in shape — it just receives the corrected `creditContext`.

For `withAuthAndCredits` line ~493, same pattern: capture `deducted`, use for any post-deduction tracking. (The existing `buildCreditContext` callback is invoked by the handler with the *projected* deduction; that's fine for the handler's reactive UI. The post-deduction enrichment uses the actual.)

## TDD sequence

1. **R1**: add a vitest test for `withUserCreditsBatch` (or the simplest of the three) that seeds a user with balance below the calculated `creditsToDeduct`, runs the wrapper, and asserts the wrapper does NOT throw and the credits row drops to zero. Run — fails because the wrapper currently throws on shortfall.
2. **G1**: migrate `withUserCreditsBatch` line ~436 to pass `allowPartial: true` and capture `deducted`. Re-run — passes.
3. **R2 + G2**: same shape for `withAuthAndCreditsBatch` line ~346.
4. **R3 + G3**: same shape for `withAuthAndCredits` line ~537.
5. **R4 + G4 (regression guard)**: add one test asserting that `applyBatchItemDeductions` still salvages on INSUFFICIENT_CREDITS (its callback NOT migrated). Confirms the per-item path is intact.

If a wrapper-level test file does not yet exist, create `convex/ai/helpers.test.ts` with the canonical `convex-test` setup.

## Files touched

- `convex/ai/helpers.ts` (3 deduction sites, plus the `creditContext` ordering for two of them)
- `convex/ai/helpers.test.ts` (new file, or extend if it exists) — wrapper-level drain-to-zero tests

## Migration stance

Additive at the wrapper layer — every wrapper continues to accept the same args, throws the same error codes, returns the same shape. Only the **billing semantics on shortfall** change: from "error the entire AI call" to "drain wallet to zero, succeed once".

## Test plan

- `npx vitest run convex/ai/helpers.test.ts` — green.
- Existing tests that exercise these wrappers indirectly (screening, translation suites) — green, no behavioral regression.
- `npx tsc --noEmit` — clean.

## Deployability gate

- `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` after the commit. (If pm2 idle: `npx convex dev --once`.)
- No `✖ Error` lines.

## Acceptance criteria

- Three single-deduction sites in `convex/ai/helpers.ts` pass `allowPartial: true`, capture `deducted`, and use it for `creditContext`.
- `applyBatchItemDeductions` callback at line ~338 is unchanged.
- Wrapper-level test verifies a user with insufficient balance gets a successful response and a zero balance instead of an `AI_INSUFFICIENT_CREDITS` throw (provided pre-flight passed).
- Pre-flight check at lines 269 / 384 / 512 is unchanged — drain-to-zero only catches in-flight overruns, not pre-flight floor failures.

## Known pitfalls

- **Pre-flight still throws.** Drain-to-zero doesn't bypass the pre-flight balance check at lines 269 / 384 / 512. A user with balance < `ESTIMATED_CREDITS_PER_QUERY` still gets `AI_INSUFFICIENT_CREDITS`. That's correct — drain-to-zero only handles in-flight overruns once we've decided the request is fundable.
- **`creditContext` ordering.** In two wrappers the `creditContext` object is built BEFORE the deduction call. After migration it MUST be built AFTER, using `deducted` not `creditsToDeduct`, so PostHog tracks the actual amount.
- **`applyBatchItemDeductions` callback signature** uses raw `(args) => ctx.runMutation(...)`. Its caller cannot opt into `allowPartial` without changing the callback signature too. Don't.
- **`throwStructuredAIError` normalization** at line 70-78 catches bare `INSUFFICIENT_CREDITS` and rethrows as `AI_INSUFFICIENT_CREDITS`. Drain-to-zero never throws, so this normalization path becomes dormant for the migrated sites — the salvage path still relies on it.
