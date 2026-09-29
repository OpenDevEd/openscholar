import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";

/**
 * Clears `models.webSearchPrice`, which nothing reads now that web search is
 * priced as one flat Exa rate. The sync already stops writing it; this reaches
 * retired rows too. Run once per deployment, then drop the field:
 *   npx convex run migrations/clearModelWebSearchPrice:run
 * Idempotent; each batch schedules the next.
 */
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ cleared: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("models").paginate({ numItems: 200, cursor: cursor ?? null });
    let cleared = 0;
    for (const row of page.page) {
      if (row.webSearchPrice === undefined) continue;
      await ctx.db.patch(row._id, { webSearchPrice: undefined });
      cleared++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.migrations.clearModelWebSearchPrice.run, { cursor: page.continueCursor });
    }
    return { cleared, isDone: page.isDone };
  },
});
