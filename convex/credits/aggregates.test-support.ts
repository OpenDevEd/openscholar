/**
 * Shared test helper: register the three @convex-dev/aggregate facet-count
 * instances (plans/billing-transactions-perf/01) AND the two
 * @convex-dev/sharded-counter instances backing free/paid balance reads.
 * Every test that exercises a mutation writing to `creditTransactions`
 * (deductCredits, grantMonthly, addCredits, etc.) MUST call this after
 * creating the test handle, or the component runtime will reject the
 * inserts with `Component "txnTypeAgg" is not registered`.
 *
 * The `.test-support.ts` extension (two dots) keeps this file out of the
 * Convex bundler — its import graph pulls in `convex-test`,
 * `@convex-dev/aggregate/test`, and `@convex-dev/sharded-counter/test`,
 * which are test-only dependencies.
 */

import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import { register as registerAggregate } from "@convex-dev/aggregate/test";
import { register as registerShardedCounter } from "@convex-dev/sharded-counter/test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { computeSearchableText } from "../../lib/billing/transactions/search-text";
import { recordTransactionCounters } from "./aggregates";

export function setupTransactionAggregates<
  S extends SchemaDefinition<GenericSchema, boolean>,
>(t: TestConvex<S>): void {
  const ht = t as unknown as TestConvex<SchemaDefinition<GenericSchema, boolean>>;
  registerAggregate(ht, "txnTypeAgg");
  registerAggregate(ht, "txnCreditPoolAgg");
  registerAggregate(ht, "txnBillingTypeAgg");
  registerShardedCounter(ht, "balanceFreeCounter");
  registerShardedCounter(ht, "balancePaidCounter");
}

/**
 * Seed helper: insert a `credits` anchor row and seed initial free/paid
 * balances via `grant` / `purchase` transactions, driving the
 * `balanceFreeCounter` / `balancePaidCounter` shards through
 * `recordTransactionCounters`. Replaces the legacy
 * `ctx.db.insert("credits", { freeBalance, paidBalance, ... })` seed
 * pattern that no longer compiles.
 *
 * Caller must have invoked `setupTransactionAggregates(t)` so the
 * sharded counters are registered, otherwise the inserts will reject at
 * runtime.
 */
export async function seedCreditsForTest(
  ctx: MutationCtx,
  args: { userId: Id<"users">; free?: number; paid?: number; now?: number },
): Promise<Id<"credits">> {
  const now = args.now ?? Date.now();
  const creditsId = await ctx.db.insert("credits", {
    userId: args.userId,
    createdAt: now,
  });

  const free = args.free ?? 0;
  if (free > 0) {
    const description = `Test seed grant (${free} free)`;
    const txId = await ctx.db.insert("creditTransactions", {
      creditsId,
      userId: args.userId,
      type: "grant",
      creditType: "free",
      amount: free,
      description,
      createdAt: now,
      searchableText: computeSearchableText({ description, type: "grant" }),
    });
    await recordTransactionCounters(ctx, {
      _id: txId,
      creditsId,
      type: "grant",
      creditType: "free",
      amount: free,
      createdAt: now,
    });
  }

  const paid = args.paid ?? 0;
  if (paid > 0) {
    const description = `Test seed purchase (${paid} paid)`;
    const txId = await ctx.db.insert("creditTransactions", {
      creditsId,
      userId: args.userId,
      type: "purchase",
      creditType: "paid",
      amount: paid,
      description,
      createdAt: now,
      searchableText: computeSearchableText({ description, type: "purchase" }),
    });
    await recordTransactionCounters(ctx, {
      _id: txId,
      creditsId,
      type: "purchase",
      creditType: "paid",
      amount: paid,
      createdAt: now,
    });
  }

  return creditsId;
}
