/**
 * Per-user credit balance backed by two `@convex-dev/sharded-counter`
 * instances — one per pool. Replaces the Tier D `balanceAgg`
 * DirectAggregate whose `.sum()` walked the lazy-root B+ tree on every
 * read and blew the 16 MB per-mutation budget on fat ledgers.
 *
 * Two counters, both keyed by `Id<"credits">`:
 *
 *   - `balanceFreeCounter` — the user's free-pool balance.
 *   - `balancePaidCounter` — the user's paid-pool balance.
 *
 * Total balance is derived (`free + paid`). Choosing two counters over
 * one keyed by `[creditsId, pool]` saves a shard read when callers only
 * need a single pool and matches the `(free, paid)` shape Tier D already
 * exposes downstream.
 *
 * `defaultShards: 16` matches the library default. Credits writes per
 * user are settled usage, grant, purchase, and occasional refund rows,
 * far lower fan-out than the per-job paper counters (which run 50-way
 * and picked 64). Sticky-shard keeps repeat writers on the same shard
 * until contention is observed.
 *
 * The mutation-side API is signed: `addBalanceDelta(ctx, id, pool, n)`
 * adds `n` (positive for credits-in, negative for credits-out) to the
 * appropriate pool. The library's `.add(ctx, key, signedAmount)` supports
 * negative counts natively, so there is no separate debit method.
 *
 * Donor module: `convex/extraction/jobCounters.ts` — same shape, just a
 * different key type and shard count.
 */

import { ShardedCounter } from "@convex-dev/sharded-counter";
import { components } from "../_generated/api";
import type {
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import type { Id } from "../_generated/dataModel";

type RunMutationCtx = {
  runMutation: GenericMutationCtx<never>["runMutation"];
};
type RunQueryCtx = { runQuery: GenericQueryCtx<never>["runQuery"] };

const balanceFreeCounter = new ShardedCounter<Id<"credits">>(
  components.balanceFreeCounter,
  { defaultShards: 16 },
);
const balancePaidCounter = new ShardedCounter<Id<"credits">>(
  components.balancePaidCounter,
  { defaultShards: 16 },
);

export type CreditPool = "free" | "paid";

export type CreditPoolSnapshot = {
  free: number;
  paid: number;
  total: number;
};

/**
 * Snapshot the user's free + paid balance from the sharded counters.
 *
 * O(shards) per pool — the library's `count()` reads all 16 shard rows
 * for each counter and sums in-process. Safe to call from queries and
 * mutations; the read cost is bounded regardless of ledger depth.
 */
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

/**
 * Apply a signed delta to one pool's counter. Positive amounts add
 * credits (grant / purchase / refund-in), negative amounts remove
 * credits (usage / refund-out).
 *
 * Zero-amount calls short-circuit so the recordTransactionCounters
 * branch doesn't pay a shard write for a no-op.
 */
export async function addBalanceDelta(
  ctx: RunMutationCtx,
  creditsId: Id<"credits">,
  pool: CreditPool,
  signedAmount: number,
): Promise<void> {
  if (signedAmount === 0) return;
  const counter =
    pool === "free" ? balanceFreeCounter : balancePaidCounter;
  await counter.add(ctx, creditsId, signedAmount);
}

/**
 * Zero both pools for a creditsId. Used by the admin cascade-clear path
 * (`clearUserTransactionCounters`) and the one-shot seed mutation
 * (`seedBalanceCountersFromLedger`) before it rebuilds from the ledger.
 */
export async function clearBalanceCounters(
  ctx: RunMutationCtx,
  creditsId: Id<"credits">,
): Promise<void> {
  await Promise.all([
    balanceFreeCounter.reset(ctx, creditsId),
    balancePaidCounter.reset(ctx, creditsId),
  ]);
}
