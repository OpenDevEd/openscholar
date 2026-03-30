import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../featureFlags/guard";

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireFeature(ctx, "extraction.enabled");
    await requireFeature(ctx, "extraction.pdf");
    await requireAuth(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
