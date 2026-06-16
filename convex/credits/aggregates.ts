/**
 * @convex-dev/aggregate wiring for per-user transaction facet counts.
 *
 * Three DirectAggregate instances back the filter-dropdown count badges in
 * `components/billing/transactions/transactions-panel-toolbar.tsx`. Each is
 * namespaced by `credits._id` so concurrent inserts from one user never
 * OCC-contend with another user's writes, and the B-tree for a given user
 * is bounded by that user's lifetime ledger rather than the whole table.
 *
 *   - txnTypeAgg         — Key = [TransactionType, hashTxId]
 *   - txnCreditPoolAgg   — Key = [CreditType,      hashTxId]
 *   - txnBillingTypeAgg  — Key = [BillingType,     hashTxId]   (absent when
 *                          the row has no billingType)
 *
 * The second key slot is a 32-bit FNV-1a hash of the transaction _id — it
 * has no semantic, exists only to distribute parallel inserts across B-tree
 * leaves within each facet's prefix. The previous `createdAt`-keyed scheme
 * collapsed all writes onto the rightmost leaf of each prefix under fan-
 * out, re-creating the OCC contention the aggregate was supposed to absorb.
 *
 * Reads happen via `countBatch` with `prefix: [facetValue]` — one component
 * round-trip returns the count for every bucket value of a dimension.
 * Date-range counts CANNOT use the aggregate (the hash slot has no time
 * ordering); they fall back to an indexed `creditTransactions` scan on
 * `by_credits_createdAt` with in-app counting per facet. This is O(N) in
 * the user's transactions within the window, which is fine because the
 * window is user-scoped and bounded.
 *
 * Balance reads are NOT here — they live in `./balanceCounter.ts`
 * (`readBalance`, `addBalanceDelta`, `clearBalanceCounters`), backed by
 * two `@convex-dev/sharded-counter` instances. The previous Tier D
 * `balanceAgg` DirectAggregate read the lazy-root B+ tree on every
 * `getBalance`, blowing the 16 MB / mutation budget on fat ledgers; the
 * counters are O(shards) regardless of ledger depth.
 *
 * Writes are insert-only — the production `creditTransactions` table is
 * append-only — so the `forget*` helpers exist for symmetry with
 * `convex/extraction/aggregates.ts` but are only used by the cascade-clear
 * path in dev/admin tooling.
 *
 * Usage boundary: every `ctx.db.insert("creditTransactions", ...)` site in
 * `convex/credits/internal.ts` calls `recordTransactionCounters` with the
 * just-inserted row's minimal shape. The query side calls
 * `readTransactionFacetCounts` (facet UI) or `readBalance` (balance reads,
 * from `balanceCounter.ts`).
 */

import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Id } from "../_generated/dataModel";
import {
  addBalanceDelta,
  clearBalanceCounters,
} from "./balanceCounter";

type RunMutationCtx = { runMutation: GenericMutationCtx<never>["runMutation"] };
type RunQueryCtx = { runQuery: GenericQueryCtx<never>["runQuery"] };

// Convex query ctx that can also read a table directly. Date-range facet
// counts fall back to an indexed table scan (`by_credits_createdAt`)
// because the aggregate's second key slot is a row-stable hash, not a
// timestamp — composite-key range bounds on it would be meaningless.
type FacetQueryCtx = RunQueryCtx & {
  db: GenericQueryCtx<DataModel>["db"];
};

/**
 * 32-bit FNV-1a hash of a creditTransactions._id, returned as an unsigned
 * integer that fits comfortably in JS's safe-integer range. Used as the
 * second component of each aggregate key so writes for one (creditsId,
 * facetValue) namespace land at uniformly distributed B-tree positions —
 * fixing the rightmost-leaf collapse that the previous `[enum, createdAt]`
 * scheme suffered under fan-out. Deterministic per _id, so a backfill
 * pass over already-recorded rows still produces the same (key, id)
 * position and `insertIfDoesNotExist` remains a true no-op.
 */
function hashTxId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type TransactionType =
  | "purchase"
  | "usage"
  | "grant"
  | "refund"
  | "expiry";

export type LedgerType = TransactionType;

export type CreditType = "free" | "paid";
export type BillingType =
  | "extraction_llm"
  | "embedding"
  | "screening"
  | "chat"
  | "search"
  | "translation"
  | "wallet_api";

export const TRANSACTION_TYPES: readonly TransactionType[] = [
  "purchase",
  "usage",
  "grant",
  "refund",
  "expiry",
];
export const CREDIT_TYPES: readonly CreditType[] = ["free", "paid"];
export const BILLING_TYPES: readonly BillingType[] = [
  "extraction_llm",
  "embedding",
  "screening",
  "chat",
  "search",
  "translation",
  "wallet_api",
];

export const txnTypeAgg = new DirectAggregate<{
  Namespace: Id<"credits">;
  Key: [TransactionType, number];
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
 * Minimal shape the aggregate helpers need — structurally compatible with
 * `Doc<"creditTransactions">` so call sites can pass either a just-
 * inserted synthetic row or a real doc from the backfill iterator.
 *
 * `amount` is the signed ledger summand. It feeds the sharded-counter
 * delta so balance reads (`readBalance` in `./balanceCounter.ts`) reflect
 * every ledger entry.
 */
export type TransactionForAggregate = {
  _id: Id<"creditTransactions">;
  creditsId: Id<"credits">;
  type: LedgerType;
  creditType: CreditType;
  billingType?: BillingType;
  amount: number;
  createdAt: number;
};

/**
 * Record one creditTransaction into the user-visible facet aggregates and
 * apply the signed amount to the balance counter. Uses
 * `insertIfDoesNotExist` so a mutation retry (OCC) or a backfill pass
 * over an already-recorded row is a no-op for the aggregates — the key's
 * second slot is `hashTxId(_id)`, deterministic per row.
 *
 * Note: ShardedCounter's `.add()` is NOT idempotent — a retried mutation
 * that re-runs this helper for the SAME `_id` would double-count. Convex
 * OCC retries re-run the whole mutation transaction (so the underlying
 * `ctx.db.insert("creditTransactions", ...)` would itself produce a new
 * `_id`), and the donor caller pattern is "insert-then-record" inside
 * one mutation, so retries roll back together.
 *
 * Call AFTER `ctx.db.insert` succeeds so `_id` is final.
 */
export async function recordTransactionCounters(
  ctx: RunMutationCtx,
  tx: TransactionForAggregate,
): Promise<void> {
  const tieBreaker = hashTxId(tx._id);

  const balancePromise = addBalanceDelta(
    ctx,
    tx.creditsId,
    tx.creditType,
    tx.amount,
  );

  await Promise.all([
    balancePromise,
    txnTypeAgg.insertIfDoesNotExist(ctx, {
      namespace: tx.creditsId,
      key: [tx.type, tieBreaker],
      id: tx._id,
    }),
    txnCreditPoolAgg.insertIfDoesNotExist(ctx, {
      namespace: tx.creditsId,
      key: [tx.creditType, tieBreaker],
      id: tx._id,
    }),
    tx.billingType
      ? txnBillingTypeAgg.insertIfDoesNotExist(ctx, {
          namespace: tx.creditsId,
          key: [tx.billingType, tieBreaker],
          id: tx._id,
        })
      : Promise.resolve(),
  ]);
}

/**
 * Reverse `recordTransactionCounters`. `deleteIfExists` tolerates drift
 * for the facet aggregates. The balance-counter side applies an
 * equal-and-opposite delta — the counter has no per-row state to "miss",
 * so this is symmetric with the insert side. Unused on the production
 * path (ledger is insert-only) but provided for symmetry and for
 * dev/admin cascade-delete paths.
 */
export async function forgetTransactionCounters(
  ctx: RunMutationCtx,
  tx: TransactionForAggregate,
): Promise<void> {
  const tieBreaker = hashTxId(tx._id);

  const balancePromise = addBalanceDelta(
    ctx,
    tx.creditsId,
    tx.creditType,
    -tx.amount,
  );

  await Promise.all([
    balancePromise,
    txnTypeAgg.deleteIfExists(ctx, {
      namespace: tx.creditsId,
      key: [tx.type, tieBreaker],
      id: tx._id,
    }),
    txnCreditPoolAgg.deleteIfExists(ctx, {
      namespace: tx.creditsId,
      key: [tx.creditType, tieBreaker],
      id: tx._id,
    }),
    tx.billingType
      ? txnBillingTypeAgg.deleteIfExists(ctx, {
          namespace: tx.creditsId,
          key: [tx.billingType, tieBreaker],
          id: tx._id,
        })
      : Promise.resolve(),
  ]);
}

/**
 * Wipe every facet entry and zero both balance counters for a user.
 * Production creditTransactions is insert-only, so this is dev/admin
 * tooling only.
 */
export async function clearUserTransactionCounters(
  ctx: RunMutationCtx,
  creditsId: Id<"credits">,
): Promise<void> {
  await Promise.all([
    txnTypeAgg.clear(ctx, { namespace: creditsId }),
    txnCreditPoolAgg.clear(ctx, { namespace: creditsId }),
    txnBillingTypeAgg.clear(ctx, { namespace: creditsId }),
    clearBalanceCounters(ctx, creditsId),
  ]);
}

export type FacetCounts = {
  type: Record<TransactionType, number>;
  creditPool: Record<CreditType, number>;
  billingType: Record<BillingType, number>;
};

type DateRange = { from: number; to: number } | null;

/**
 * Read the 5 + 2 + 7 = 14 bucket counts for a user, optionally bounded by
 * a date range.
 *
 *   - no date range  → aggregate fast path. Three parallel `countBatch`
 *                       calls with `prefix: [facetValue]`, one component
 *                       round-trip per dimension. O(log n).
 *   - with date range → indexed scan fast path. One pass over
 *                       `by_credits_createdAt` bounded by [from, to],
 *                       counting each row into all three facet buckets in
 *                       app code. O(N_within_range) for this user.
 *
 * Convention A semantics: counts reflect the full user ledger within the
 * current date range, ignoring other-facet selections. See
 * `plans/billing-transactions-perf/00-README.md` §D4 for rationale.
 */
export async function readTransactionFacetCounts(
  ctx: FacetQueryCtx,
  creditsId: Id<"credits">,
  dateRange: DateRange,
): Promise<FacetCounts> {
  if (dateRange === null) {
    return await readFacetsFromAggregates(ctx, creditsId);
  }
  return await readFacetsFromIndex(ctx, creditsId, dateRange);
}

async function readFacetsFromAggregates(
  ctx: RunQueryCtx,
  creditsId: Id<"credits">,
): Promise<FacetCounts> {
  const [typeCounts, creditPoolCounts, billingTypeCounts] = await Promise.all([
    txnTypeAgg.countBatch(
      ctx,
      TRANSACTION_TYPES.map((v) => ({
        namespace: creditsId,
        bounds: { prefix: [v] as [TransactionType] },
      })),
    ),
    txnCreditPoolAgg.countBatch(
      ctx,
      CREDIT_TYPES.map((v) => ({
        namespace: creditsId,
        bounds: { prefix: [v] as [CreditType] },
      })),
    ),
    txnBillingTypeAgg.countBatch(
      ctx,
      BILLING_TYPES.map((v) => ({
        namespace: creditsId,
        bounds: { prefix: [v] as [BillingType] },
      })),
    ),
  ]);

  return {
    type: zipCounts(TRANSACTION_TYPES, typeCounts),
    creditPool: zipCounts(CREDIT_TYPES, creditPoolCounts),
    billingType: zipCounts(BILLING_TYPES, billingTypeCounts),
  };
}

async function readFacetsFromIndex(
  ctx: FacetQueryCtx,
  creditsId: Id<"credits">,
  dateRange: { from: number; to: number },
): Promise<FacetCounts> {
  const type = zeroRecord(TRANSACTION_TYPES);
  const creditPool = zeroRecord(CREDIT_TYPES);
  const billingType = zeroRecord(BILLING_TYPES);

  for await (const row of ctx.db
    .query("creditTransactions")
    .withIndex("by_credits_createdAt", (q) =>
      q
        .eq("creditsId", creditsId)
        .gte("createdAt", dateRange.from)
        .lte("createdAt", dateRange.to),
    )) {
    type[row.type as TransactionType] += 1;
    creditPool[row.creditType as CreditType] += 1;
    if (row.billingType) {
      billingType[row.billingType as BillingType] += 1;
    }
  }

  return { type, creditPool, billingType };
}

function zeroRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = 0;
  return out;
}

function zipCounts<K extends string>(
  keys: readonly K[],
  counts: readonly number[],
): Record<K, number> {
  const out = {} as Record<K, number>;
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = counts[i] ?? 0;
  }
  return out;
}
