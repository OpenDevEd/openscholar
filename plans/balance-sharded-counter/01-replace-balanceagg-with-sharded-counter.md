# Plan 01 — Replace `balanceAgg` with two `ShardedCounter` instances

## Goal

Make `readBalance(creditsId)` an O(shards-per-pool) constant-cost read so the Tier D reservation path (`convex/credits/reservation.ts:120`) and every other read site stays under Convex's 16 MB / mutation budget regardless of ledger depth. Preserve the Tier D atomicity guarantee (check-and-reserve in one mutation; TOCTOU closed).

## Scope

In:
- `convex/convex.config.ts`
- `convex/credits/balanceCounter.ts` (new)
- `convex/credits/aggregates.ts`
- `convex/credits/aggregates.test-support.ts`
- `convex/credits/internal.ts`
- `convex/credits/reservation.ts`
- `convex/testing/billing.ts`
- `convex/screening/mutations.ts`
- `convex/extraction/mutations/{retry,resume,jobs}.ts`
- `convex/extraction/aggregates.test-support.ts` (drop `balanceAgg` registration)
- Test files that imported `getBalance` or `balanceAgg`
- `convex/crons.ts` (reconciliation cron)
- New: `convex/credits/balanceCounter.test.ts`, drift action under `convex/credits/internal.ts`

Out:
- `creditsAgg`, `txnTypeAgg`, `txnCreditPoolAgg`, `txnBillingTypeAgg` — untouched.
- Frontend; balance reads continue to flow through `internal.credits.internal.getBalanceByUserId` (rename internal call, public shape unchanged).

## Design

### Component registration (`convex/convex.config.ts`)

Replace the existing line `app.use(aggregate, { name: "balanceAgg" });` with:

```ts
app.use(shardedCounter, { name: "balanceFreeCounter" });
app.use(shardedCounter, { name: "balancePaidCounter" });
```

`shardedCounter` is already imported (used for `extractionProcessedCounter` / `extractionFailedCounter`).

### New module `convex/credits/balanceCounter.ts`

Mirror `convex/extraction/jobCounters.ts` exactly.

```ts
import { ShardedCounter } from "@convex-dev/sharded-counter";
import { components } from "../_generated/api";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { Id } from "../_generated/dataModel";

type RunMutationCtx = { runMutation: GenericMutationCtx<never>["runMutation"] };
type RunQueryCtx = { runQuery: GenericQueryCtx<never>["runQuery"] };

const balanceFreeCounter = new ShardedCounter<Id<"credits">>(
  components.balanceFreeCounter,
  { defaultShards: 16 },
);
const balancePaidCounter = new ShardedCounter<Id<"credits">>(
  components.balancePaidCounter,
  { defaultShards: 16 },
);

export type CreditPoolSnapshot = { free: number; paid: number; total: number };

export async function readBalance(
  ctx: RunQueryCtx,
  creditsId: Id<"credits">,
): Promise<CreditPoolSnapshot> {
  const [free, paid] = await Promise.all([
    balanceFreeCounter.count(ctx, creditsId),
    balancePaidCounter.count(ctx, creditsId),
  ]);
  return { free, paid, total: free + paid };
}

export async function addBalanceDelta(
  ctx: RunMutationCtx,
  creditsId: Id<"credits">,
  creditType: "free" | "paid",
  signedAmount: number,
): Promise<void> {
  if (signedAmount === 0) return;
  const counter = creditType === "free" ? balanceFreeCounter : balancePaidCounter;
  await counter.add(ctx, creditsId, signedAmount);
}

export async function clearBalanceCounters(
  ctx: RunMutationCtx,
  creditsId: Id<"credits">,
): Promise<void> {
  await Promise.all([
    balanceFreeCounter.reset(ctx, creditsId),
    balancePaidCounter.reset(ctx, creditsId),
  ]);
}
```

### Rewire `convex/credits/aggregates.ts`

- Delete the `balanceAgg` `DirectAggregate` declaration (current lines 174-178).
- Delete the file-level comment block that describes `balanceAgg`'s key shape and Tier D rationale (current lines 34-47, 167-178, 318-329) — out-of-date once the aggregate is gone.
- In `recordTransactionCounters` (current line 214) drop the `balancePromise = balanceAgg.insertIfDoesNotExist(...)` branch and replace it with `addBalanceDelta(ctx, tx.creditsId, tx.creditType, tx.amount)`. Run it in parallel with the user-visible facet writes via `Promise.all`.
- In `forgetTransactionCounters` (current line 261) drop the `balanceAgg.deleteIfExists` branch and replace it with `addBalanceDelta(ctx, tx.creditsId, tx.creditType, -tx.amount)`.
- In `clearUserTransactionCounters` (current line 305) drop the `balanceAgg.clear` call and replace it with `clearBalanceCounters(ctx, creditsId)`.
- Delete `getBalance` (current lines 330-345). Read sites import `readBalance` from `balanceCounter.ts` directly.

### Rewire call sites of `getBalance`

| File | Current | After |
| --- | --- | --- |
| `convex/credits/internal.ts:90` | `getBalance(ctx, credits._id)` | `readBalance(ctx, credits._id)` |
| `convex/credits/reservation.ts:116,120` | `getBalance(ctx, credits._id)` | `readBalance(ctx, credits._id)` |
| `convex/testing/billing.ts:241` | `getBalance(ctx, row._id)` | `readBalance(ctx, row._id)` |
| `convex/screening/mutations.ts:88` | `(await getBalance(ctx, credits._id)).total` | `(await readBalance(ctx, credits._id)).total` |
| `convex/extraction/mutations/{retry,resume,jobs}.ts` | same | same |
| 4 test files | same | same |

Import: `import { readBalance } from "../credits/balanceCounter";` (path adapted per source location).

### Seed mutation (one-shot per credits row)

Add to `convex/credits/internal.ts`:

```ts
export const seedBalanceCountersFromLedger = internalMutation({
  args: { creditsId: v.id("credits") },
  returns: v.object({
    creditsId: v.id("credits"),
    free: v.number(),
    paid: v.number(),
    total: v.number(),
  }),
  handler: async (ctx, { creditsId }) => {
    let free = 0;
    let paid = 0;
    for await (const tx of ctx.db
      .query("creditTransactions")
      .withIndex("by_credits", (q) => q.eq("creditsId", creditsId))) {
      if (tx.creditType === "free") free += tx.amount;
      else if (tx.creditType === "paid") paid += tx.amount;
    }
    await clearBalanceCounters(ctx, creditsId);
    await addBalanceDelta(ctx, creditsId, "free", free);
    await addBalanceDelta(ctx, creditsId, "paid", paid);
    return { creditsId, free, paid, total: free + paid };
  },
});
```

Caller runs this once per credits row via the Convex dashboard after the migration commit lands.

### Reconciliation cron

Add to `convex/crons.ts` and a new internal action under `convex/credits/internal.ts`:

```ts
crons.interval(
  "balance counter drift audit",
  { hours: 1 },
  internal.credits.internal.auditBalanceDrift,
  {},
);
```

`auditBalanceDrift` picks up to 16 random `credits` rows, recomputes balance from `by_credits_createdAt` (which already exists), compares with `readBalance`, and `console.error`s when |delta| > 0. No self-healing. Pure observability.

### Test-support cleanup

- `convex/credits/aggregates.test-support.ts:30`: remove `registerAggregate(ht, "balanceAgg")`. Add `registerShardedCounter(ht, "balanceFreeCounter")` + `registerShardedCounter(ht, "balancePaidCounter")`.
- `convex/extraction/aggregates.test-support.ts:40`: remove `registerAggregate(ht, "balanceAgg")` (also drop — same fixture covers credit-flow tests).
- Any test that imported `balanceAgg` from `aggregates.ts` either calls `readBalance` to assert post-state, or is deleted if it was probing aggregate internals.

## TDD sequence

**Phase A — pure logic / new module (TDD red→green→commit per test):**

R1 — `readBalance` reads zero from a fresh creditsId.
R2 — `addBalanceDelta(ctx, id, "paid", 100)` then `readBalance` returns `{ free: 0, paid: 100, total: 100 }`.
R3 — Mixed-sign sequence: `add 100 free, add -30 free, add 50 paid` → `{ free: 70, paid: 50, total: 120 }`.
R4 — `addBalanceDelta(ctx, id, "free", 0)` is a no-op (no shard write).
R5 — `clearBalanceCounters` resets both pools.

Each R1-R5 = one commit `test(credits): [plan-01] add Rk balanceCounter <thing>` + `feat(credits): [plan-01] implement Rk` (or one commit per cycle if you write the test + impl together — the doctrine allows either as long as the green is per logical unit).

**Phase B — integration / rewire (test-after, one commit per unit):**

U1. Register `balanceFreeCounter` / `balancePaidCounter` in `convex.config.ts`; delete the `balanceAgg` line. Run `npx pm2 logs convex --lines 5 --nostream` — `✔ Convex functions ready!` must appear. Commit `chore(convex): [plan-01] register balance sharded counters`.

U2. Rewire `recordTransactionCounters` + `forgetTransactionCounters` + `clearUserTransactionCounters` in `aggregates.ts` to call `addBalanceDelta` / `clearBalanceCounters`. Delete the `balanceAgg` declaration. Update or delete tests in `convex/credits/aggregates.test.ts` that referenced `balanceAgg` directly. Run `pnpm test convex/credits/aggregates.test.ts`. Commit `refactor(credits): [plan-01] route counter writes through balanceCounter`.

U3. Delete `getBalance` from `aggregates.ts`. Update all 11 import sites to `readBalance`. Run `pnpm tsc --noEmit` and the credits/extraction test suites. Commit `refactor(credits): [plan-01] rename getBalance to readBalance and rewire callers`.

U4. Clean up `convex/credits/aggregates.test-support.ts` and `convex/extraction/aggregates.test-support.ts` to drop `balanceAgg` registration; register the two ShardedCounters in the credits support file. Commit `test(credits): [plan-01] update aggregate test support for sharded counters`.

U5. Add `seedBalanceCountersFromLedger` internalMutation. Add a vitest for it: prefill a ledger of mixed-pool transactions, call the seed mutation, assert counters equal the algebraic sum per pool. Commit `feat(credits): [plan-01] add seedBalanceCountersFromLedger admin mutation`.

U6. Add `auditBalanceDrift` internalAction and register the cron. Add a vitest: corrupt one counter, run the action, assert the log captures the drift. Commit `feat(credits): [plan-01] add hourly balance counter drift audit cron`.

U7. TOCTOU regression: write a test in `convex/credits/reservation.test.ts` that runs two concurrent `reserveCreditsTransaction({ amount: 80 })` mutations against a starting balance of 100 and asserts exactly one succeeds. Commit `test(credits): [plan-01] TOCTOU regression for sharded-counter balance reads`.

U8. Run `seedBalanceCountersFromLedger` from the Convex dashboard for each existing dev `credits` row (manual step in the dashboard — not a commit). Verify via `readBalance` that the previously corrupted user (`ultirus@gmail.com`) lands at `{ free: 0, paid: 10000, total: 10000 }`.

U9. Re-run the originally failing extraction job (`kd789g61xpe93tjm0xeaz8ds8d86qc41` or any equivalent against the fat-ledger user) and confirm pm2 convex logs show no `Too many bytes read` error. Commit (if any post-run cleanup) `chore(credits): [plan-01] post-migration verification`.

## Files touched

- `convex/convex.config.ts`
- `convex/credits/balanceCounter.ts` (new)
- `convex/credits/balanceCounter.test.ts` (new)
- `convex/credits/aggregates.ts`
- `convex/credits/aggregates.test.ts`
- `convex/credits/aggregates.test-support.ts`
- `convex/credits/internal.ts`
- `convex/credits/reservation.ts`
- `convex/credits/reservation.test.ts` (new TOCTOU regression)
- `convex/testing/billing.ts`
- `convex/screening/mutations.ts`
- `convex/extraction/mutations/retry.ts`
- `convex/extraction/mutations/resume.ts`
- `convex/extraction/mutations/jobs.ts`
- `convex/extraction/aggregates.test-support.ts`
- `convex/extraction/*.test.ts` (4 files using `getBalance` in tests)
- `tests/user-creation.test.ts`
- `convex/crons.ts`

## Migration stance

Destructive. `balanceAgg` removed entirely. No shim. Counters start at zero on first push; the seed mutation re-builds them from the canonical ledger for each existing credits row.

## Test plan

- `pnpm test convex/credits/balanceCounter.test.ts` — five R1-R5 unit tests green.
- `pnpm test convex/credits/aggregates.test.ts` — recordTransactionCounters round-trips green.
- `pnpm test convex/credits/reservation.test.ts` — TOCTOU regression green.
- `pnpm test convex/credits/internal.test.ts` (or equivalent) — seed mutation + audit action green.
- `pnpm tsc --noEmit` clean.
- After U8 dashboard seed: a live action from `convex/wallet/gateway/handler.ts` (any wallet read) returns the expected `{ free, paid, total }` for the fat-ledger user.

## Deployability gate

After every commit in U1-U7 and U9 that touches `convex/`:

```
npx pm2 logs convex --lines 5 --nostream
```

Must show `✔ Convex functions ready!` as the most recent state line. NO `✖ Error`. NO repeating `- Preparing Convex functions...`.

After U2 specifically: verify the deployed function spec for `recordTransactionCounters` accepts the new shape (no stale returns validator). After U6: verify `crons.ts` registered the new cron without throwing.

## Acceptance criteria

1. `balanceAgg` does not appear in any file under `convex/`, including test support and test files.
2. `getBalance` does not appear as an export anywhere; `readBalance` is the only API.
3. `pnpm tsc --noEmit` is clean.
4. All listed test files are green.
5. `npx pm2 logs convex --lines 5 --nostream` shows `✔ Convex functions ready!` after the final commit.
6. `seedBalanceCountersFromLedger` has been invoked at least once per existing dev `credits` row (verified by `readBalance` on the previously-corrupted user).
7. A retry of an extraction job for the fat-ledger user completes without `Too many bytes read` in the convex error log.

## Known pitfalls

- **Sticky-shard determinism**: ShardedCounter's internal `stickyShard` map is process-local. Two parallel mutations from different Convex workers MAY hit different shards for the same creditsId — that's the point. The component reconciles. Do not try to pin shards.
- **`reset(ctx, key)` is not atomic with concurrent `add`**: if a `recordTransactionCounters` lands during `seedBalanceCountersFromLedger`, the seeded total may drift by that delta. Workaround: run the seed during a quiet window (no in-flight extractions for that user) OR wrap seed+rebuild in a single mutation (already the case — `internalMutation` is a transaction). The latter is what we do, and Convex's per-mutation OCC retries handle the race.
- **Tier D atomic semantics are preserved**: `reserveCreditsTransaction` reads `readBalance` then issues `addBalanceDelta` in the same mutation. Convex transactions guarantee the read-set / write-set conflict detection. The TOCTOU regression test in U7 proves this.
- **Counter cannot go negative if a deduct exceeds balance**: the existing reservation check (`balance.total < args.amount → throw`) already prevents this. Confirm in the TOCTOU test.
- **Dashboard seed is manual**. Document it in the commit message of U5 so the user knows to run it before the migration is complete.
- **`auditBalanceDrift` MUST be an internalAction, not a mutation**, so its loop over many credits rows doesn't blow the 16 MB mutation budget — same failure mode this whole plan exists to fix.
