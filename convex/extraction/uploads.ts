import { mutation } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { requireExtractionEnabled } from "./guard";

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    requireExtractionEnabled();
    await requireAuth(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});
