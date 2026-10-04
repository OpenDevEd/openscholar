import { internalQuery, mutation } from "../lib/functions";
import { v } from "convex/values";
import { requireEvidenceLibraryAccess } from "./access";

/**
 * Step one of an owner upload. The browser posts the file to the returned
 * URL, then calls `uploadActions.upload` with the storage id it gets back.
 */
export const generateUploadUrl = mutation({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    return await ctx.storage.generateUploadUrl();
  },
});

/** Owner check for the upload actions, which cannot read the database. */
export const requireUploadOwner = internalQuery({
  args: { libraryId: v.id("evidenceLibraries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireEvidenceLibraryAccess(ctx, args.libraryId, "manage");
    return null;
  },
});
