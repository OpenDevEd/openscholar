import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const upsertPricing = internalMutation({
  args: {
    entries: v.array(
      v.object({
        modelId: v.string(),
        inputPerMillion: v.number(),
        outputPerMillion: v.number(),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, { entries }) => {
    const now = Date.now();
    let written = 0;

    for (const entry of entries) {
      const existing = await ctx.db
        .query("pricingCache")
        .withIndex("by_model", (q) => q.eq("modelId", entry.modelId))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          inputPerMillion: entry.inputPerMillion,
          outputPerMillion: entry.outputPerMillion,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("pricingCache", {
          modelId: entry.modelId,
          inputPerMillion: entry.inputPerMillion,
          outputPerMillion: entry.outputPerMillion,
          updatedAt: now,
        });
      }
      written++;
    }

    return written;
  },
});
