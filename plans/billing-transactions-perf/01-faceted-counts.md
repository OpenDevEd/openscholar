# Plan 01 — Faceted Counts: Aggregate-Backed Filter Badges

**Depends on:** nothing. **Blocks:** nothing. (Independent of plans 02 and 03.)

## Goal

Replace the page-local `counts` memo in `components/billing/transactions/transactions-panel-client.tsx:316-324` with three reactive `DirectAggregate` subscriptions that report the user's *full* ledger totals under the current date range. The filter-dropdown badges stop drifting with scroll. Convention A semantics (date-respected, other-facets-ignored) per `00-README.md` §D4.

Implements decisions **D1**–**D7**, **D14**, **D16**.

## Scope

**In scope**

- Three new aggregate instances in `convex/convex.config.ts`: `txnTypeAgg`, `txnCreditPoolAgg`, `txnBillingTypeAgg`.
- New module `convex/credits/aggregates.ts` exposing helpers: `recordTransactionCounters(ctx, doc)`, `forgetTransactionCounters(ctx, doc)`, `clearUserTransactionCounters(ctx, creditsId)`, `readTransactionFacetCounts(ctx, creditsId, dateRange?)`.
- New public query `api.credits.queries.getTransactionFacetCounts` returning `{ type, creditPool, billingType }` shaped records.
- Call-site hooks — 11 `ctx.db.insert("creditTransactions", ...)` sites in:
  - `convex/credits/internal.ts` × 9 (`deductCredits` 1-2 inserts, `grantMonthlyCredits`, `grantUpgradeProRataCredits`, `grantPurchasedCreditsFromPaymentIntent`, `grantPurchasedCreditsFromCheckout`, `reversePurchasedCreditsFromRefund`, `addCredits`).
  - `convex/wallet/gateway/handler.ts` × 1 (via `deductCredits` — covered transitively).
  - `convex/ai/helpers.ts` × 1 (via `deductCredits` — covered transitively).
- Backfill migration `convex/migrations/backfillTransactionCounters.ts` — paginated per-row `insertIfDoesNotExist`.
- Client rewire in `transactions-panel-client.tsx`: remove `counts` useMemo + `bumpCount`; subscribe to `getTransactionFacetCounts` via `useProtectedQuery`; pass result to `TransactionsPanelToolbar`.
- Tests: `convex/credits/aggregates.test.ts` (helpers + query); extend `tests/components/billing/transactions/transactions-panel-client.test.tsx` (counts no longer derived from rows).

**Out of scope**

- Tab counts (tabs do not show counts today; no behavior change).
- Disjunctive exclude-self semantics (convention B — deferred).
- Server-side narrowing for `creditPools` / `billingTypes` (plan 02).
- Enrichment cache (plan 03).
- Any schema change beyond the three `app.use(aggregate, ...)` registrations.

## Design

### 1. Aggregate instances — `convex/convex.config.ts`

Append three `app.use` calls mirroring the existing four instances:

```ts
// plan-perf-01: per-user transaction facet counts — one B-tree per (creditsId, dimension)
// so no cross-user OCC contention. Keys carry createdAt in trailing position for
// O(log n) date-range counts. Reads via countBatch, one round-trip per dimension.
app.use(aggregate, { name: "txnTypeAgg" });
app.use(aggregate, { name: "txnCreditPoolAgg" });
app.use(aggregate, { name: "txnBillingTypeAgg" });
```

Convention: 1-line comment above; compact block after the existing extraction aggregates.

### 2. `convex/credits/aggregates.ts`

Structurally identical to `convex/extraction/aggregates.ts`. Three `DirectAggregate` constants, four exported helpers, one `Counters`-style result shape.

```ts
import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";

type RunMutationCtx = { runMutation: GenericMutationCtx<never>["runMutation"] };
type RunQueryCtx = { runQuery: GenericQueryCtx<never>["runQuery"] };

type TransactionType = "purchase" | "usage" | "grant" | "refund" | "expiry";
type CreditType = "free" | "paid";
type BillingType =
  | "extraction_llm"
  | "embedding"
  | "screening"
  | "chat"
  | "search"
  | "translation"
  | "wallet_api";

const TRANSACTION_TYPES: readonly TransactionType[] = [
  "purchase", "usage", "grant", "refund", "expiry",
];
const CREDIT_TYPES: readonly CreditType[] = ["free", "paid"];
const BILLING_TYPES: readonly BillingType[] = [
  "extraction_llm", "embedding", "screening", "chat", "search", "translation", "wallet_api",
];

export const txnTypeAgg = new DirectAggregate<{
  Namespace: Id<"credits">;
  Key: [TransactionType, number];      // [type, createdAt]
  Id: Id<"creditTransactions">;
}>(components.txnTypeAgg);

export const txnCreditPoolAgg = new DirectAggregate<{
  Namespace: Id<"credits">;
  Key: [CreditType, number];
  Id: Id<"creditTransactions">;
}>(components.txnCreditPoolAgg);

export const txnBillingTypeAgg = new DirectAggregate<{
  Namespace: Id<"credits">;
  Key: [BillingType, number];
  Id: Id<"creditTransactions">;
}>(components.txnBillingTypeAgg);

/**
 * Record one creditTransaction into all applicable aggregates. Uses
 * insertIfDoesNotExist so a retried mutation (OCC) is a no-op. Call
 * AFTER ctx.db.insert succeeds so the id is final.
 */
export async function recordTransactionCounters(
  ctx: RunMutationCtx,
  doc: Doc<"creditTransactions">,
): Promise<void> {
  await Promise.all([
    txnTypeAgg.insertIfDoesNotExist(ctx, {
      namespace: doc.creditsId,
      key: [doc.type, doc.createdAt],
      id: doc._id,
    }),
    txnCreditPoolAgg.insertIfDoesNotExist(ctx, {
      namespace: doc.creditsId,
      key: [doc.creditType, doc.createdAt],
      id: doc._id,
    }),
    doc.billingType
      ? txnBillingTypeAgg.insertIfDoesNotExist(ctx, {
          namespace: doc.creditsId,
          key: [doc.billingType, doc.createdAt],
          id: doc._id,
        })
      : Promise.resolve(),
  ]);
}

/**
 * Reverse recordTransactionCounters. deleteIfExists tolerates drift —
 * the caller must not throw if the row is absent from an aggregate.
 * Unused today (creditTransactions is insert-only) but provided for
 * symmetry and future cascade-delete paths.
 */
export async function forgetTransactionCounters(
  ctx: RunMutationCtx,
  doc: Doc<"creditTransactions">,
): Promise<void> {
  await Promise.all([
    txnTypeAgg.deleteIfExists(ctx, {
      namespace: doc.creditsId,
      key: [doc.type, doc.createdAt],
      id: doc._id,
    }),
    txnCreditPoolAgg.deleteIfExists(ctx, {
      namespace: doc.creditsId,
      key: [doc.creditType, doc.createdAt],
      id: doc._id,
    }),
    doc.billingType
      ? txnBillingTypeAgg.deleteIfExists(ctx, {
          namespace: doc.creditsId,
          key: [doc.billingType, doc.createdAt],
          id: doc._id,
        })
      : Promise.resolve(),
  ]);
}

/**
 * Wipe every entry in all three aggregates for a user. Called only from
 * dev reset / admin tooling — production creditTransactions is insert-only.
 */
export async function clearUserTransactionCounters(
  ctx: RunMutationCtx,
  creditsId: Id<"credits">,
): Promise<void> {
  await Promise.all([
    txnTypeAgg.clear(ctx, { namespace: creditsId }),
    txnCreditPoolAgg.clear(ctx, { namespace: creditsId }),
    txnBillingTypeAgg.clear(ctx, { namespace: creditsId }),
  ]);
}

export type FacetCounts = {
  type: Record<TransactionType, number>;
  creditPool: Record<CreditType, number>;
  billingType: Record<BillingType, number>;
};

/**
 * Read the 5 + 2 + 7 = 14 bucket counts for a user, optionally bounded by
 * a date range. Three parallel countBatch calls — one round-trip per dim.
 */
export async function readTransactionFacetCounts(
  ctx: RunQueryCtx,
  creditsId: Id<"credits">,
  dateRange: { from: number; to: number } | null,
): Promise<FacetCounts> {
  const boundsFor = <K extends string>(
    value: K,
  ): { prefix: [K] } | {
    lower: { key: [K, number]; inclusive: true };
    upper: { key: [K, number]; inclusive: true };
  } => {
    if (!dateRange) return { prefix: [value] };
    return {
      lower: { key: [value, dateRange.from], inclusive: true },
      upper: { key: [value, dateRange.to], inclusive: true },
    };
  };

  const [typeCounts, creditPoolCounts, billingTypeCounts] = await Promise.all([
    txnTypeAgg.countBatch(
      ctx,
      TRANSACTION_TYPES.map((v) => ({ namespace: creditsId, bounds: boundsFor(v) })),
    ),
    txnCreditPoolAgg.countBatch(
      ctx,
      CREDIT_TYPES.map((v) => ({ namespace: creditsId, bounds: boundsFor(v) })),
    ),
    txnBillingTypeAgg.countBatch(
      ctx,
      BILLING_TYPES.map((v) => ({ namespace: creditsId, bounds: boundsFor(v) })),
    ),
  ]);

  const zip = <K extends string>(keys: readonly K[], counts: readonly number[]) =>
    Object.fromEntries(keys.map((k, i) => [k, counts[i] ?? 0])) as Record<K, number>;

  return {
    type: zip(TRANSACTION_TYPES, typeCounts),
    creditPool: zip(CREDIT_TYPES, creditPoolCounts),
    billingType: zip(BILLING_TYPES, billingTypeCounts),
  };
}
```

Shape mirrors `convex/extraction/aggregates.ts` — same import style, same helper naming convention (`record*` / `forget*` / `clear*` / `read*`), same `RunMutationCtx` / `RunQueryCtx` typing.

### 3. Call-site hooks — insert-site wrapping

Each of the 11 `ctx.db.insert("creditTransactions", ...)` call sites becomes:

```ts
const txId = await ctx.db.insert("creditTransactions", { ... });
const txDoc = await ctx.db.get(txId);
if (txDoc) await recordTransactionCounters(ctx, txDoc);
```

The `ctx.db.get(txId)` read is necessary because the doc we pass to `recordTransactionCounters` needs `_id` and `_creationTime` which aren't in the inline insert object. Alternative: construct the `Doc<...>` shape inline with the known fields + synthesize `_id: txId` + drop `_creationTime` from the helper's reliance — but using `ctx.db.get(txId)` is clearer and is the pattern used in the extraction aggregates module. The read is cheap (same transaction, just-written doc, likely cached).

**Sites to edit** (all verified via audit):

| # | File | Function | Lines (approx) |
|---|---|---|---|
| 1 | `convex/credits/internal.ts` | `deductCredits` — free-only path | 1502-1513 |
| 2 | `convex/credits/internal.ts` | `deductCredits` — free-spillover free insert | 1519-1530 |
| 3 | `convex/credits/internal.ts` | `deductCredits` — free-spillover paid insert | 1536-1547 |
| 4 | `convex/credits/internal.ts` | `grantMonthlyCredits` | ~791 |
| 5 | `convex/credits/internal.ts` | `grantUpgradeProRataCredits` | ~939 |
| 6 | `convex/credits/internal.ts` | `grantPurchasedCreditsFromPaymentIntent` | ~1117 |
| 7 | `convex/credits/internal.ts` | `grantPurchasedCreditsFromCheckout` | ~1260 |
| 8 | `convex/credits/internal.ts` | `reversePurchasedCreditsFromRefund` | ~1368 |
| 9 | `convex/credits/internal.ts` | `addCredits` | ~1617 |
| 10 | (covered by #1–3) `convex/wallet/gateway/handler.ts` routes to `deductCredits` | — | — |
| 11 | (covered by #1–3) `convex/ai/helpers.ts` routes to `deductCredits` | — | — |

Effective diff: **9 hook sites** (since wallet + ai/helpers go through `deductCredits`).

Before executing: delegate an `Explore` agent to grep `ctx\.db\.insert\s*\(\s*"creditTransactions"` and confirm the count. If a new site has appeared since the audit, add it to the punch list.

### 4. Public query — `getTransactionFacetCounts`

Appended to `convex/credits/queries.ts`:

```ts
import { readTransactionFacetCounts } from "./aggregates";

const facetCountsValidator = v.object({
  type: v.record(v.string(), v.number()),
  creditPool: v.record(v.string(), v.number()),
  billingType: v.record(v.string(), v.number()),
});

export const getTransactionFacetCounts = query({
  args: {
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  returns: v.union(facetCountsValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!credits) return null;

    const dateRange =
      args.from != null && args.to != null
        ? { from: args.from, to: args.to }
        : null;

    return await readTransactionFacetCounts(ctx, credits._id, dateRange);
  },
});
```

Ownership check: `credits` is looked up via `by_user` on the authenticated identity — no client-passed userId. Matches `getMyBalance` / `listTransactionsPaginated` auth shape.

### 5. Backfill migration — `convex/migrations/backfillTransactionCounters.ts`

```ts
import { migrations } from "./runner";  // assumes existing Migrations instance; else define per extraction/aggregates.ts pattern
import { recordTransactionCounters } from "../credits/aggregates";
import { internal } from "../_generated/api";

export const backfillTransactionCountersMigration = migrations.define({
  table: "creditTransactions",
  migrateOne: async (ctx, doc) => {
    // insertIfDoesNotExist means re-runs are no-ops
    await recordTransactionCounters(ctx, doc);
  },
});

export const runBackfillTransactionCounters = migrations.runner(
  internal.migrations.backfillTransactionCounters.backfillTransactionCountersMigration,
);
```

Check first whether the project has a shared `migrations` instance — `convex/migrations/backfillBillingTypes.ts` is the template to mirror. If that file uses `migrations.define(...)`, follow suit; if it uses `internalMutation` with manual cursor pagination, follow that instead.

Runbook: `npx convex run migrations/backfillTransactionCounters:runBackfillTransactionCounters` after deploy, in each environment with existing data.

### 6. Client rewire — `transactions-panel-client.tsx`

Remove:

```ts
function bumpCount(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}
// ...
const counts = useMemo(() => {
  const c: Record<string, number> = {};
  for (const row of baseRows) {
    bumpCount(c, `type:${row.type}`);
    bumpCount(c, `creditPool:${row.creditType}`);
    if (row.billingType) bumpCount(c, `billingType:${row.billingType}`);
  }
  return c;
}, [baseRows]);
```

Replace with:

```ts
import { useProtectedQuery } from "@/lib/auth/use-auth-query";

// ...
const facetCounts = useProtectedQuery(
  api.credits.queries.getTransactionFacetCounts,
  {
    from: state.from ? state.from.getTime() : undefined,
    to: state.to ? state.to.getTime() : undefined,
  },
);

const counts = useMemo(() => {
  const c: Record<string, number> = {};
  if (!facetCounts?.data) return c;
  const { type, creditPool, billingType } = facetCounts.data;
  for (const [k, v] of Object.entries(type)) c[`type:${k}`] = v;
  for (const [k, v] of Object.entries(creditPool)) c[`creditPool:${k}`] = v;
  for (const [k, v] of Object.entries(billingType)) c[`billingType:${k}`] = v;
  return c;
}, [facetCounts?.data]);
```

`TransactionsPanelToolbar`'s `Props` contract is unchanged. The `FilterMultiSelect` rendering a zero-count option as enabled is acceptable — the user can still select it; the filter will return an empty set, which renders the existing `no-matches` empty state.

**Loading state**: while `facetCounts` is undefined on first paint, counts render as "—" or "0" in the badge. Decision: use `?? 0` — the transient zero is bounded by a single Convex round-trip (~50ms), less disruptive than a skeleton flash on a tiny badge.

### 7. Acceptance of convention A vs B

Counts reflect the full user ledger under the current date range. Selecting `creditPools=[free]` does NOT reduce the `type` counts — if this is surprising, it's acceptable for a billing ledger where tabs (not facets) define the primary scope. Upgrade path to convention B: extend aggregate namespaces to `[creditsId, otherFacetValue1, otherFacetValue2]` and read via namespace enumeration. Deferred; not part of this plan.

## TDD sequence — aggregate helpers

Commit after each green. Prefix: `feat(billing-txn-perf): [plan-01] <what>`.

### `convex/credits/aggregates.test.ts` (via `convex-test`)

1. RED: `recordTransactionCounters` on a purchase row increments `txnTypeAgg` count under namespace=creditsId, key-prefix=`["purchase"]` by 1.
2. RED: `recordTransactionCounters` on a row with `billingType=undefined` skips `txnBillingTypeAgg` entirely (count stays 0).
3. RED: Two inserts with the same `_id` (OCC retry simulation) leave the count at 1 (idempotency via `insertIfDoesNotExist`).
4. RED: `forgetTransactionCounters` on an unrecorded row does NOT throw (deleteIfExists tolerance).
5. RED: `readTransactionFacetCounts` on an empty creditsId returns all zeros across 14 buckets.
6. RED: `readTransactionFacetCounts` with `dateRange: null` returns lifetime counts.
7. RED: `readTransactionFacetCounts` with a narrow `dateRange` returns only in-range counts.
8. RED: `clearUserTransactionCounters` drops all 14 buckets to 0 in one call.
9. GREEN: implement helpers.

### `convex/credits/getTransactionFacetCounts.test.ts`

10. RED: unauthenticated caller → `null`.
11. RED: authenticated user with no credits row → `null`.
12. RED: authenticated user with 3 purchases + 2 usages → `{ type: { purchase: 3, usage: 2, grant: 0, refund: 0, expiry: 0 }, ... }`.
13. RED: with `from`/`to` bounding only the last hour and all 5 txns outside → all counts 0.
14. GREEN: implement the query.

## Files touched

### New

- `convex/credits/aggregates.ts`
- `convex/credits/aggregates.test.ts`
- `convex/credits/getTransactionFacetCounts.test.ts`
- `convex/migrations/backfillTransactionCounters.ts` (check if `convex/migrations/runner.ts` exists; if not, define the `Migrations` instance per the pattern in `backfillBillingTypes.ts`)

### Modified

- `convex/convex.config.ts` — 3 new `app.use(aggregate, ...)` registrations.
- `convex/credits/queries.ts` — add `getTransactionFacetCounts`.
- `convex/credits/internal.ts` — 9 insert sites wrapped with `recordTransactionCounters` call.
- `components/billing/transactions/transactions-panel-client.tsx` — remove `counts` memo + `bumpCount`; subscribe to new query; derive `counts` from response.
- `tests/components/billing/transactions/transactions-panel-client.test.tsx` (if it exists; otherwise add coverage in a new file) — extend to assert counts come from the subscription, not from the rendered rows.

### Dependencies

None added. `@convex-dev/aggregate` and `@convex-dev/migrations` are already installed.

## Migration stance

**Additive.** The three new aggregates start empty. After deploy, run `npx convex run migrations/backfillTransactionCounters:runBackfillTransactionCounters` once per environment. Because `insertIfDoesNotExist` is idempotent, the backfill is safe to re-run. Until the backfill completes, the counts will under-report — gate the client rewire behind a feature flag OR run the backfill before merging the client rewire commit, depending on the chosen ship sequence.

**Suggested sequence**: land the aggregate + helper + insert-site hooks + backfill migration in one PR (no UI change yet — old `counts` memo still runs). Run the backfill in each environment. Then land the client rewire in a second PR. The aggregate will be populated and hot before the client reads from it.

## Test plan

### Pure logic

TDD sequence above covers the aggregate helpers and the query.

### Integration

Via `convex-test`:

- **Write site — deductCredits**: simulate a deduct that triggers the two-row path (free exhausted, spillover to paid). Assert both rows appear in `txnTypeAgg` (2 × `usage`), `txnCreditPoolAgg` (1 × `free` + 1 × `paid`), and `txnBillingTypeAgg` (2 × `billingType` if set, 0 otherwise).
- **Write site — grantMonthlyCredits**: simulate a grant. Assert 1 × `grant`, 1 × `free`, 0 × billingType (grants never carry billingType).
- **Write site — reversePurchasedCreditsFromRefund**: simulate a refund. Assert 1 × `refund`, 1 × `paid`, 0 × billingType.
- **Backfill**: seed 50 legacy creditTransactions without aggregate entries. Run the migration. Assert `readTransactionFacetCounts` returns the expected distribution.
- **Backfill idempotency**: run the migration twice in a row. Second run is a no-op; counts unchanged.

### Client

- **Pagination invariance**: mount the panel with a user who has 200 transactions (5 of each type). Load first page (25 rows). Assert `counts.type:purchase === 40` (the actual lifetime count, not 5 — which would be the page-local derivation). Load more pages; counts stay at 40. No drift.
- **Date range**: apply a narrow date range. Assert counts update reactively (Convex subscription fires). Clear date range; counts return to lifetime totals.

## Acceptance criteria

- [ ] Three `app.use(aggregate, { name: ... })` calls in `convex.config.ts`.
- [ ] `convex/credits/aggregates.ts` committed with four exported helpers + green TDD cases 1–9.
- [ ] `api.credits.queries.getTransactionFacetCounts` callable; green TDD cases 10–14.
- [ ] `convex/migrations/backfillTransactionCounters.ts` committed; backfill runs clean in a test env.
- [ ] 9 insert sites in `convex/credits/internal.ts` carry a `recordTransactionCounters` call immediately after their `ctx.db.insert`.
- [ ] Client `transactions-panel-client.tsx` no longer computes `counts` from `baseRows`; subscribes to the new query instead.
- [ ] `bumpCount` helper + its import removed; no lingering references in the file.
- [ ] Extended component test asserts counts come from the subscription, not from the rendered-row count. (Per project testing doctrine: assert on behavior / data-* / ARIA, never class strings.)
- [ ] Browser smoke: the bug is gone — open `/settings/billing`, scroll the list, watch the filter-dropdown counts stay stable (do NOT increase with scroll).

## Known pitfalls

- **Aggregate component dashboard edits**: `npx convex import` / dashboard mutations bypass `ctx.db.insert` wrappers, so entries inserted that way don't land in the aggregates. Recovery: re-run the backfill. Document in PR.
- **`@convex-dev/aggregate@0.2.1` monotonic-key hotspot**: namespace + `[dimension, createdAt]` sort-key means concurrent inserts into the same `(creditsId, type)` slice serialize through the aggregate's B-tree leaf. At typical per-user write rates (<1/sec) this is a non-issue. If a user generates a burst (extraction job pumping 1000 usage rows in 2 seconds), the serialization cost is visible but still bounded — the namespace-per-user isolation prevents global contention.
- **Deduct-credits two-row path**: a single `deductCredits` call can insert two rows (free spillover into paid). Both calls to `recordTransactionCounters` happen in the same transaction. Confirm the `Promise.all` inside the helper doesn't violate Convex's parallel-write constraint for the SAME document — it doesn't here, because the two rows have different `_id`s and the three aggregate instances are separate components.
- **`countBatch` bounds shape**: the aggregate docs specify `prefix: [value]` OR `{ lower, upper }` but NOT both. When `dateRange === null` we use `prefix`; when set, we use `lower` + `upper` with the full composite key. Do NOT try to combine prefix + range bounds in one call — it's an illegal shape.
- **Client `useMemo` dependency key**: `facetCounts?.data` must remain referentially stable across renders when the underlying values don't change. `useProtectedQuery` returns a subscription snapshot whose object identity does flip on every Convex broadcast; that's fine — the memo's output is cheap to recompute and React 19 Compiler handles most of the rest.
- **Backfill timing during rollout**: if the client rewire ships before the backfill completes, counts will be lower than the actual ledger until the backfill finishes its batches. The plan's recommended two-PR split avoids this. If a single-PR rollout is mandated, gate the subscription reads behind a feature flag (e.g., `featureFlags.transactionCountsFromAggregate`).
- **`creditTransactions._creationTime` vs `createdAt`**: the schema has a custom `createdAt` field separate from Convex's system `_creationTime`. Aggregate key uses `createdAt` (the domain timestamp) to keep semantics consistent with the rest of the code, which already uses `createdAt` for display / filtering / sort.

## Future enhancement (out of scope, documented for follow-up)

**Convention B (disjunctive exclude-self counts)** — when a user selects `creditPools=[free]`, the `type` counts should reflect only `free`-pool rows. This requires either (a) extending each aggregate's namespace to `[creditsId, otherFacet1, otherFacet2]` and summing across the user's currently-selected other-facet values, or (b) a separate aggregate per facet combination. The UX memo recommended B, but the audit confirmed A fully addresses the user's complaint and is ~half the surface area. Ship A; revisit B if user research shows people combine multi-select facets heavily.
