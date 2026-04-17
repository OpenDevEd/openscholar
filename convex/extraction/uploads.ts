import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { requireFeature } from "../featureFlags/guard";
import { createError } from "../lib/errors";
import { MAX_PDF_BYTES, MAX_PDF_MB } from "../../lib/files/limits";

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

export const recordUploadedFile = mutation({
  args: { storageId: v.id("_storage") },
  returns: v.object({
    storageId: v.id("_storage"),
    bytes: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireFeature(ctx, "extraction.enabled");
    await requireFeature(ctx, "extraction.pdf");
    await requireAuth(ctx);

    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata) {
      throw createError("NOT_FOUND", "Uploaded file not found");
    }

    if (metadata.size > MAX_PDF_BYTES) {
      throw createError(
        "VALIDATION_ERROR",
        `Uploaded file exceeds maximum size of ${MAX_PDF_MB} MB`,
      );
    }

    return { storageId: args.storageId, bytes: metadata.size };
  },
});
