import { query } from "../_generated/server";
import { v } from "convex/values";

/**
 * All curated model-config rows (small table — presets + per-provider defaults).
 * The client joins each `modelId` to the `models` catalog for live pricing/desc.
 */
export const list = query({
  args: {},
  returns: v.array(
    v.object({
      key: v.string(),
      modelId: v.string(),
      label: v.union(v.string(), v.null()),
      blurb: v.union(v.string(), v.null()),
      sortOrder: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("aiModelConfig").collect();
    return rows.map((r) => ({
      key: r.key,
      modelId: r.modelId,
      label: r.label ?? null,
      blurb: r.blurb ?? null,
      sortOrder: r.sortOrder ?? null,
    }));
  },
});
