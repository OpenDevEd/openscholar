import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

export const getCachedPricing = internalQuery({
  args: { modelId: v.string() },
  returns: v.union(
    v.object({ input: v.number(), output: v.number() }),
    v.null(),
  ),
  handler: async (ctx, { modelId }) => {
    const row = await ctx.db
      .query("pricingCache")
      .withIndex("by_model", (q) => q.eq("modelId", modelId))
      .unique();
    if (!row) return null;
    return { input: row.inputPerMillion, output: row.outputPerMillion };
  },
});
