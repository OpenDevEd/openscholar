import { query } from "../_generated/server";
import { v } from "convex/values";
import { modelSummaryValidator, serverPresetValidator } from "../aiModelConfig/validators";
import { modelSummary, oneModelId } from "../ai/serverModel";
import { getCurrentUser } from "../lib/auth";

/**
 * The current user's server-model choice, or null if unauthenticated or never
 * set (which means Recommended). `model` is the one model every task runs on,
 * or null when tasks run on Recommended, including when the picked model is no
 * longer offered.
 */
export const get = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      serverPreset: serverPresetValidator,
      model: v.union(modelSummaryValidator, v.null()),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const cfg = await ctx.db
      .query("userAiConfig")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!cfg) return null;

    return {
      serverPreset: cfg.serverPreset,
      model: await modelSummary(ctx, await oneModelId(ctx, user._id)),
    };
  },
});
