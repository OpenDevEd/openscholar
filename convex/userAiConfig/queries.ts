import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";

const serverPresetValidator = v.union(
  v.literal("fast"),
  v.literal("balanced"),
  v.literal("intelligent"),
  v.literal("custom"),
);

/**
 * The current user's server-model choice, or null if unauthenticated / never set.
 * `serverModelId` is the remembered custom pick (sticky); resolution only uses it
 * when `serverPreset === "custom"`.
 */
export const get = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      serverPreset: serverPresetValidator,
      serverModelId: v.union(v.id("models"), v.null()),
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

    return { serverPreset: cfg.serverPreset, serverModelId: cfg.serverModelId ?? null };
  },
});
