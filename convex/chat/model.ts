/** The models a chat can run on, with the effort levels each takes, for the composer. */

import { query } from "../_generated/server";
import { v } from "convex/values";
import { activeModels, MAX_CATALOG_MODELS, pickable, usableFor } from "../models/catalog";
import { effortValidator } from "../aiModelConfig/validators";

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
      reasoningEfforts: v.optional(v.array(effortValidator)),
      defaultEffort: v.optional(effortValidator),
    }),
  ),
  handler: async (ctx) => {
    // Chat lets you pick ANY catalog model (isServed is curation, not a runtime
    // gate). Served models keep their curated sortOrder; the rest sort last.
    const rows = pickable(await activeModels(ctx).take(MAX_CATALOG_MODELS)).filter((row) => usableFor(row, "chat"));
    return rows.map((m) => ({
      _id: m._id,
      modelId: m.modelId,
      name: m.name,
      provider: m.provider,
      sortOrder: m.sortOrder,
      contextLength: m.contextLength,
      supportedParameters: m.supportedParameters,
      reasoningEfforts: m.reasoningEfforts,
      defaultEffort: m.defaultEffort,
    }));
  },
});
