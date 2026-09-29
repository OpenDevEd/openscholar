import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireAdmin } from "../admins/access";
import { requireAvailableModel, requireEffort } from "../models/catalog";
import { presetConfigKey } from "../../lib/ai/tasks";
import { aiTaskValidator, effortValidator, presetKeyValidator } from "./validators";

/** Sets the model and effort a preset runs a task on. */
export const setPresetPick = mutation({
  args: { preset: presetKeyValidator, task: aiTaskValidator, modelId: v.id("models"), effort: v.optional(effortValidator) },
  returns: v.null(),
  handler: async (ctx, { preset, task, modelId, effort }) => {
    await requireAdmin(ctx);
    const model = await requireAvailableModel(ctx, modelId);
    requireEffort(model, effort);
    const key = presetConfigKey(preset, task);
    const row = await ctx.db
      .query("aiModelConfig")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const fields = { modelId: model.modelId, effort, updatedAt: Date.now() };
    if (row) await ctx.db.patch("aiModelConfig", row._id, fields);
    else await ctx.db.insert("aiModelConfig", { key, ...fields });
    return null;
  },
});
