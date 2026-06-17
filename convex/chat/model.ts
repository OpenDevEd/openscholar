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
      contextLength: v.optional(v.number()),
      supportedParameters: v.optional(v.array(v.string())),
    }),
  ),
  handler: async (ctx) => {
    // Chat lets you pick ANY catalog model (isServed is curation, not a runtime
    // gate). Served models keep their curated sortOrder; the rest sort last.
    const rows = await ctx.db.query("models").collect();
    return rows.map((m) => ({
      _id: m._id,
      modelId: m.modelId,
      name: m.name,
      provider: m.provider,
      sortOrder: m.sortOrder,
      contextLength: m.contextLength,
      supportedParameters: m.supportedParameters,
    }));
  },
});
