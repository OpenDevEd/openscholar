/**
 * @convex-dev/aggregate wiring for per-user transaction facet counts
 * (plans/billing-transactions-perf/01).
 *
 * Three DirectAggregate instances back the filter-dropdown count badges in
 * `components/billing/transactions/transactions-panel-toolbar.tsx`. Each is
 * namespaced by `credits._id` so concurrent inserts from one user never
 * OCC-contend with another user's writes, and the B-tree for a given user
 * is bounded by that user's lifetime ledger rather than the whole table.
 *
 *   - txnTypeAgg         — Key = [TransactionType, createdAt]
 *   - txnCreditPoolAgg   — Key = [CreditType,      createdAt]
 *   - txnBillingTypeAgg  — Key = [BillingType,     createdAt]   (absent when
 *                          the row has no billingType)
 *
 * Reads happen via `countBatch` — one component round-trip returns the count
 * for every bucket value of a dimension. With `createdAt` trailing the
 * composite key, a date-range count is O(log n) via compound bounds.
 *
 * Writes are insert-only — the production `creditTransactions` table is
 * append-only — so the `forget*` helpers exist for symmetry with
 * `convex/extraction/aggregates.ts` but are only used by the cascade-clear
 * path in dev/admin tooling.
 *
 * Usage boundary: every `ctx.db.insert("creditTransactions", ...)` site in
 * `convex/credits/internal.ts` calls `recordTransactionCounters` with the
 * just-inserted row's minimal shape. The query side calls
 * `readTransactionFacetCounts`, which is wrapped by the public query
 * `api.credits.queries.getTransactionFacetCounts`.
 */

import { DirectAggregate } from "@convex-dev/aggregate";
import { components } from "../_generated/api";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { Id } from "../_generated/dataModel";

type RunMutationCtx = { runMutation: GenericMutationCtx<never>["runMutation"] };
type RunQueryCtx = { runQuery: GenericQueryCtx<never>["runQuery"] };

export type TransactionType =
  | "purchase"
  | "usage"
  | "grant"
  | "refund"
  | "expiry";
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
 */
export type TransactionForAggregate = {
  _id: Id<"creditTransactions">;
  creditsId: Id<"credits">;
  type: TransactionType;
  creditType: CreditType;
  billingType?: BillingType;
  createdAt: number;
};

/**
 * Record one creditTransaction into all applicable aggregates. Uses
 * `insertIfDoesNotExist` so a mutation retry (OCC) or a backfill pass over
 * an already-recorded row is a no-op.
 *
 * Call AFTER `ctx.db.insert` succeeds so `_id` is final.
 */
export async function recordTransactionCounters(
  ctx: RunMutationCtx,
  tx: TransactionForAggregate,
): Promise<void> {
  await Promise.all([
    txnTypeAgg.insertIfDoesNotExist(ctx, {
      namespace: tx.creditsId,
      key: [tx.type, tx.createdAt],
      id: tx._id,
    }),
    txnCreditPoolAgg.insertIfDoesNotExist(ctx, {
      namespace: tx.creditsId,
      key: [tx.creditType, tx.createdAt],
      id: tx._id,
    }),
    tx.billingType
      ? txnBillingTypeAgg.insertIfDoesNotExist(ctx, {
          namespace: tx.creditsId,
          key: [tx.billingType, tx.createdAt],
          id: tx._id,
        })
      : Promise.resolve(),
  ]);
}

/**
 * Reverse `recordTransactionCounters`. `deleteIfExists` tolerates drift —
 * the caller must not throw if the row is absent from an aggregate.
 * Unused on the production path (ledger is insert-only) but provided for
 * symmetry and for dev/admin cascade-delete paths.
 */
export async function forgetTransactionCounters(
  ctx: RunMutationCtx,
  tx: TransactionForAggregate,
): Promise<void> {
  await Promise.all([
    txnTypeAgg.deleteIfExists(ctx, {
      namespace: tx.creditsId,
      key: [tx.type, tx.createdAt],
      id: tx._id,
    }),
    txnCreditPoolAgg.deleteIfExists(ctx, {
      namespace: tx.creditsId,
      key: [tx.creditType, tx.createdAt],
      id: tx._id,
    }),
    tx.billingType
      ? txnBillingTypeAgg.deleteIfExists(ctx, {
          namespace: tx.creditsId,
          key: [tx.billingType, tx.createdAt],
          id: tx._id,
        })
      : Promise.resolve(),
  ]);
}

/**
 * Wipe every entry in all three aggregates for a user. Production
 * creditTransactions is insert-only, so this is dev/admin tooling only.
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

type DateRange = { from: number; to: number } | null;

/**
 * Read the 5 + 2 + 7 = 14 bucket counts for a user, optionally bounded by
 * a date range. Three parallel `countBatch` calls — one component round
 * trip per dimension.
 *
 * Convention A semantics: counts reflect the full user ledger within the
 * current date range, ignoring other-facet selections. See
 * `plans/billing-transactions-perf/00-README.md` §D4 for rationale.
 */
export async function readTransactionFacetCounts(
  ctx: RunQueryCtx,
  creditsId: Id<"credits">,
  dateRange: DateRange,
): Promise<FacetCounts> {
  const [typeCounts, creditPoolCounts, billingTypeCounts] = await Promise.all([
    txnTypeAgg.countBatch(
      ctx,
      TRANSACTION_TYPES.map((v) => ({
        namespace: creditsId,
        bounds: boundsFor(v, dateRange),
      })),
    ),
    txnCreditPoolAgg.countBatch(
      ctx,
      CREDIT_TYPES.map((v) => ({
        namespace: creditsId,
        bounds: boundsFor(v, dateRange),
      })),
    ),
    txnBillingTypeAgg.countBatch(
      ctx,
      BILLING_TYPES.map((v) => ({
        namespace: creditsId,
        bounds: boundsFor(v, dateRange),
      })),
    ),
  ]);

  return {
    type: zipCounts(TRANSACTION_TYPES, typeCounts),
    creditPool: zipCounts(CREDIT_TYPES, creditPoolCounts),
    billingType: zipCounts(BILLING_TYPES, billingTypeCounts),
  };
}

function boundsFor<K extends string>(value: K, dateRange: DateRange) {
  if (!dateRange) {
    return { prefix: [value] satisfies [K] as [K] };
  }
  return {
    lower: { key: [value, dateRange.from] as [K, number], inclusive: true },
    upper: { key: [value, dateRange.to] as [K, number], inclusive: true },
  };
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
