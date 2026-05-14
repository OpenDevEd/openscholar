import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { recordTransactionCounters } from "../credits/aggregates";

/**
 * Idempotent backfill: populate the three per-user transaction facet-count
 * aggregates (txnTypeAgg, txnCreditPoolAgg, txnBillingTypeAgg) from the
 * existing `creditTransactions` table.
 *
 * `recordTransactionCounters` uses `insertIfDoesNotExist` internally, so
 * re-runs over already-recorded rows are no-ops. Safe to run repeatedly
 * during rollout or after data imports.
 *
 * Run once via:
 *   npx convex run migrations/backfillTransactionCounters:run
 */
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ processed: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("creditTransactions")
      .paginate({ numItems: 50, cursor: cursor ?? null });

    for (const row of page.page) {
      await recordTransactionCounters(ctx, {
        _id: row._id,
        creditsId: row.creditsId,
        type: row.type,
        creditType: row.creditType,
        billingType: row.billingType,
        amount: row.amount,
        createdAt: row.createdAt,
      });
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillTransactionCounters.run,
        { cursor: page.continueCursor },
      );
    }

    return { processed: page.page.length, isDone: page.isDone };
  },
});
