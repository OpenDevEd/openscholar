import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAdmin } from "../admins/access";
import { requireAvailableModel } from "../models/catalog";
import { taskConfigKey } from "../../lib/ai/tasks";
import { aiTaskValidator, presetKeyValidator } from "./validators";

async function setConfigModel(ctx: MutationCtx, key: string, modelId: Id<"models">) {
  const model = await requireAvailableModel(ctx, modelId);
  const row = await ctx.db
    .query("aiModelConfig")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (row) await ctx.db.patch("aiModelConfig", row._id, { modelId: model.modelId, updatedAt: Date.now() });
  else await ctx.db.insert("aiModelConfig", { key, modelId: model.modelId, updatedAt: Date.now() });
}

/** Sets the model Recommended runs a task on. */
export const setTaskModel = mutation({
  args: { task: aiTaskValidator, modelId: v.id("models") },
  returns: v.null(),
  handler: async (ctx, { task, modelId }) => {
    await requireAdmin(ctx);
    await setConfigModel(ctx, taskConfigKey(task), modelId);
    return null;
  },
});

/** Sets the model behind one of the chat composer's shortcuts. */
export const setPresetModel = mutation({
  args: { preset: presetKeyValidator, modelId: v.id("models") },
  returns: v.null(),
  handler: async (ctx, { preset, modelId }) => {
    await requireAdmin(ctx);
    await setConfigModel(ctx, `preset.${preset}`, modelId);
    return null;
  },
});
