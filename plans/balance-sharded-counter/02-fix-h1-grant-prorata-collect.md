# Plan 02 — H1: `grantUpgradeProRataCredits` reads bounded slice, not full ledger

## Goal

Make the upgrade-prorate dedup check O(N-in-current-period) for the user instead of O(N-lifetime). Same failure shape as the wallet bug — `.collect()` over `creditTransactions` blows the 16 MB budget for any fat-ledger user.

## Scope

In:
- `convex/credits/internal.ts` (function `grantUpgradeProRataCredits` at the `handler` block starting near line 860)
- `convex/credits/internal.test.ts` or `convex/subscriptions/actions.test.ts` (test for the dedup behavior)

Out: everything else.

## Design

Current (`convex/credits/internal.ts:867-871`):

```ts
const recentGrants = await ctx.db
  .query("creditTransactions")
  .withIndex("by_user", (q) => q.eq("userId", args.userId))
  .order("desc")
  .collect();

const existingUpgradeGrant = recentGrants.find(...);
```

Replacement:

1. Move the credits-row lookup (currently lines 918-921) ABOVE the dedup check, since the dedup is only useful if we'd otherwise grant.
2. Query `creditTransactions` via the existing `by_credits_createdAt` index (composite `[creditsId, createdAt]`), scoped to the credits row we just fetched. Async-iterate descending. Break the first time `tx.createdAt < args.currentPeriodStartMs`. Match on the upgrade-prorate signature inside the loop.

```ts
const existingCredits = await getLatestCreditsByUser(ctx, args.userId);
let existingUpgradeGrant: Doc<"creditTransactions"> | null = null;
if (existingCredits) {
  for await (const tx of ctx.db
    .query("creditTransactions")
    .withIndex("by_credits_createdAt", (q) =>
      q.eq("creditsId", existingCredits._id).gte("createdAt", args.currentPeriodStartMs),
    )
    .order("desc")) {
    if (
      tx.type === "grant" &&
      tx.metadata?.grantType === "upgrade_prorate" &&
      tx.metadata?.fromPlan === args.fromPlan &&
      tx.metadata?.toPlan === args.toPlan
    ) {
      existingUpgradeGrant = tx;
      break;
    }
  }
}
```

Reads bounded by (# of transactions for this user since current period start). For a typical monthly subscription that's a few dozen to a few hundred. Worst case: a heavy power user inside a single period — still bounded, no full-ledger scan.

The follow-on `if (existingUpgradeGrant)` early-return is unchanged. The later `createCreditsForUser` branch must check whether `existingCredits` was null and create it then (mirror current logic at lines 919-920).

## TDD sequence

R1. Insert 500 noise transactions with `createdAt < currentPeriodStartMs` (different user OR same user but pre-period). Run `grantUpgradeProRataCredits`. Assert it does not throw and returns `actuallyGranted`. Behavioral check; no class names.

R2. Insert one matching `upgrade_prorate` grant inside the current period. Call again. Assert `outcome === "already_granted"`.

R3. Insert non-matching grants inside the period (`fromPlan`/`toPlan` differ). Assert `outcome === "granted"` (does not false-positive).

Each = one TDD cycle, one commit `test(credits): [plan-02] add Rk ...` + `fix(credits): [plan-02] implement Rk` (or one commit per cycle).

## Files touched

- `convex/credits/internal.ts`
- `convex/credits/internal.test.ts` (or equivalent — wherever `grantUpgradeProRataCredits` is currently covered)

## Migration stance

Additive — no schema change.

## Test plan

- `pnpm test convex/credits/internal.test.ts` (R1-R3 green).
- `pnpm tsc --noEmit` clean.

## Deployability gate

`npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` after the final commit.

## Acceptance criteria

1. No `.collect()` over `creditTransactions` in `grantUpgradeProRataCredits`.
2. All three R1-R3 tests pass.
3. Convex push healthy.

## Known pitfalls

- The `by_credits_createdAt` index already exists; do not invent a new one.
- `getLatestCreditsByUser` returns `null` for first-ever grants on a new user (no credits row yet) — the loop must skip in that case, falling through to the create-credits branch.
- Async iteration MUST NOT be combined with `.collect()` / `.take()` per `convex/_generated/ai/guidelines.md:247`.
- Index bounds (`gte("createdAt", currentPeriodStartMs)`) make the period filter free; do not also filter in app code.
