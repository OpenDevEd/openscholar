# Plan 01 — Extend public `deductCredits` mutation with `allowPartial`

## Goal

Make the public `deductCredits` internalMutation expose what `deductCreditsTransaction` already does: support `allowPartial` opt-in, and return `{ deducted, remaining }` so callers can bill rows from actual deducted, not the estimate.

## Scope

- Mutation surface: `convex/credits/internal.ts` lines 1683-1707 only.
- Tests: `convex/credits/deduct-credits.test.ts` (12 sites), `convex/credits/aggregates.test.ts` (3 sites), `convex/wallet/wallet.test.ts:386` (1 site), `convex/wallet/gateway/gateway.test.ts` (3 sites: 1747, 1790, 1834).
- Out of scope: any production caller — those are migrated in plans 02, 03, 04 in separate commits. Production callers already discard the return value (`await ctx.runMutation(...)` with no destructure) so they keep compiling under the new shape.

## Design

```ts
// convex/credits/internal.ts:1683
export const deductCredits = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    description: v.optional(v.string()),
    jobId: v.optional(v.id("extractionJobs")),
    paperId: v.optional(v.id("extractionPapers")),
    resultId: v.optional(v.id("extractionResults")),
    billingType: v.optional(billingTypeValidator),
    metadata: v.optional(v.record(v.string(), v.string())),
    // Drain-to-zero opt-in. When true, a shortfall is absorbed
    // (deducted = totalAvailable, remaining = 0) instead of throwing.
    // The recorded transaction's metadata carries `requestedCredits`
    // and `shortfall` so audits can see the unpaid delta.
    allowPartial: v.optional(v.boolean()),
  },
  returns: v.object({
    deducted: v.number(),
    remaining: v.number(),
  }),
  handler: async (ctx, args) => {
    return await deductCreditsTransaction(ctx, args);
  },
});
```

The handler becomes a one-line passthrough — `deductCreditsTransaction` already returns `{ deducted, remaining }` and already handles the `allowPartial` branch. No new logic.

## TDD sequence

1. **R1 (red)**: in `convex/credits/deduct-credits.test.ts`, change one existing test (e.g. "deducts from free balance first") to destructure the new shape: `const { deducted, remaining } = await t.mutation(...)`; assert `deducted === 30` and `remaining === 120`. Run vitest — fails because the mutation currently returns just a number.
2. **G1 (green)**: change the mutation's `returns` validator to `v.object({ deducted, remaining })` and the handler to `return await deductCreditsTransaction(ctx, args)`. Re-run that single test — passes.
3. **R2**: add a new test in the existing `"allowPartial drain-to-zero"` describe block that calls the **public mutation** (not the helper function) with `allowPartial: true`, balance below amount, and asserts `{ deducted: balance, remaining: 0 }`. Run vitest — fails because the validator doesn't accept `allowPartial`.
4. **G2**: add `allowPartial: v.optional(v.boolean())` to the args validator. Re-run — passes.
5. **R3 + G3 (sweep)**: update remaining 11 sites in `deduct-credits.test.ts`, all 3 sites in `aggregates.test.ts`, the 1 site in `wallet.test.ts`, and the 3 sites in `gateway.test.ts` to destructure `{ remaining }` (or `{ deducted, remaining }` where the test asserts on amount). Run all four test files — green.

## Files touched

- `convex/credits/internal.ts` (mutation definition only, lines 1683-1707)
- `convex/credits/deduct-credits.test.ts` (all 12 mutation call sites)
- `convex/credits/aggregates.test.ts` (3 call sites)
- `convex/wallet/wallet.test.ts` (1 call site, line 386)
- `convex/wallet/gateway/gateway.test.ts` (3 call sites: 1747, 1790, 1834)

## Migration stance

Breaking by default — pre-testing project, dev DB disposable. The wire shape changes from `number` to `{ deducted: number, remaining: number }` in the same commit that updates every test consumer. Production consumers (the 7 sites updated in plans 02/03) currently discard the return; they keep compiling under both shapes until plans 02/03 land. No widen-then-narrow, no compatibility shim, no parallel mutation.

## Test plan

- `npx vitest run convex/credits/deduct-credits.test.ts` — all `deductCredits` describe blocks green; new `allowPartial` test green.
- `npx vitest run convex/credits/aggregates.test.ts` — green.
- `npx vitest run convex/wallet/wallet.test.ts convex/wallet/gateway/gateway.test.ts` — green.
- `npx tsc --noEmit` — clean. (Production callers discard the return; types stay sound.)

## Deployability gate

After the commit:

- `npx pm2 logs convex --lines 5 --nostream` should show `✔ Convex functions ready!` (if pm2 is running). If pm2 has zero processes (currently the case), run `npx convex dev --once` to push and confirm no `✖ Error` lines and no validator-rejection errors.
- `npx convex function-spec --prod=false credits/internal:deductCredits` — confirm the deployed validator has `allowPartial` in args and `{ deducted, remaining }` in returns. (The convex MCP `functionSpec` tool exposes this without requiring a flag.)

## Acceptance criteria

- Public `deductCredits` mutation accepts `allowPartial: v.optional(v.boolean())` in args.
- Public `deductCredits` mutation returns `v.object({ deducted: v.number(), remaining: v.number() })`.
- All existing tests in the four touched test files are green under the new shape.
- New test asserts public mutation honors `allowPartial: true` and returns capped `deducted` + zero `remaining` when balance is short.
- `npx tsc --noEmit` clean.
- Deployed function spec carries the new shape.

## Known pitfalls

- **Test files use `await t.mutation(...)` and assign to `newBalance`** — the variable was a `number`. Under the new shape it becomes an object. Sweep all 19 sites in one go; do not leave a half-converted file.
- **Convex `returns` validator strips unknown fields silently.** If `deductCreditsTransaction` ever grows a third return field, the mutation's `v.object({ deducted, remaining })` will silently drop it on the wire. Reviewers should keep these in lockstep.
- **`deductCreditsTransaction` throws `INVALID_AMOUNT` for `amount <= 0`** — that is independent of `allowPartial`. Tests passing `amount: 0` should still expect a throw.
- **The mutation handler is a one-line passthrough** — do NOT add validation, logging, or transformation here. Any new behavior belongs in `deductCreditsTransaction` so all callers (including future ones) see the same semantics.
