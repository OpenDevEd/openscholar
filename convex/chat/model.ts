/**
 * Chat model surface. For V1 we only expose a read for the picker —
 * swapModel ships in P9.T13.
 */

import { query } from "../_generated/server";
import { v } from "convex/values";

export const listChatModels = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("models"),
      modelId: v.string(),
      name: v.string(),
      provider: v.string(),
      sortOrder: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("models")
      .withIndex("by_served_sort", (q) => q.eq("isServed", true))
      .collect();
    return rows.map((m) => ({
      _id: m._id,
      modelId: m.modelId,
      name: m.name,
      provider: m.provider,
      sortOrder: m.sortOrder,
    }));
  },
});
