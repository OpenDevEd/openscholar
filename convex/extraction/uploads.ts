import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { requireExtractionEnabled, requireExtractionPdfEnabled } from "./guard";

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    requireExtractionEnabled();
    requireExtractionPdfEnabled();
    await requireAuth(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
