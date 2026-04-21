import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { computeSearchableText } from "../../lib/billing/transactions/search-text";

/**
 * Idempotent backfill: populate `searchableText` on every existing
 * `creditTransactions` row so the `search_transactions` search index can
 * return historical matches. New inserts already compute the field inline
 * (see `convex/credits/internal.ts`) — this migration only touches rows
 * that were written before the field existed.
 *
 * Re-running over fully-populated rows is a no-op (the per-row check
 * skips rows that already have a non-empty `searchableText`).
 *
 * Run once via:
 *   npx convex run migrations/backfillSearchableText:run
 */
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ patched: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("creditTransactions")
      .paginate({ numItems: 500, cursor: cursor ?? null });

    let patched = 0;
    for (const row of page.page) {
      if (row.searchableText && row.searchableText.length > 0) continue;
      const searchableText = computeSearchableText({
        description: row.description,
        metadata: row.metadata,
        billingType: row.billingType,
        type: row.type,
      });
      await ctx.db.patch(row._id, { searchableText });
      patched += 1;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillSearchableText.run,
        { cursor: page.continueCursor },
      );
    }

    return { patched, isDone: page.isDone };
  },
});
