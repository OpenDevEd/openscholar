import { v } from "convex/values";
import { mutation } from "../lib/functions";
import { FLAG_REGISTRY } from "../../lib/feature-flags/registry";
import { requireAdmin } from "../admins/access";
import { createError } from "../lib/errors";

/** Turns a registered flag on or off for everyone. */
export const setEnabled = mutation({
  args: { key: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { key, enabled }) => {
    await requireAdmin(ctx);
    if (!(key in FLAG_REGISTRY)) throw createError("NOT_FOUND", `No flag "${key}"`);
    const flag = FLAG_REGISTRY[key as keyof typeof FLAG_REGISTRY];
    const row = await ctx.db
      .query("featureFlags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row) await ctx.db.patch("featureFlags", row._id, { enabled, updatedAt: Date.now() });
    else
      await ctx.db.insert("featureFlags", {
        key,
        enabled,
        ...("planFeature" in flag ? { planFeature: flag.planFeature } : {}),
        description: flag.description,
        updatedAt: Date.now(),
      });
    return null;
  },
});
