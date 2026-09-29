import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { countUsage } from "../billing/usageLog";

/**
 * Backfill: counts charges recorded before `usageAgg` existed, so the billing
 * page's charge pages cover them. Run once per deployment:
 *   npx convex run migrations/countBillingUsage:run
 * Idempotent; each batch schedules the next.
 */
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ counted: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("billingUsage").paginate({ numItems: 200, cursor: cursor ?? null });
    for (const row of page.page) await countUsage(ctx, row);
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.countBillingUsage.run, { cursor: page.continueCursor });
    }
    return { counted: page.page.length, isDone: page.isDone };
  },
});
