import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";
import { authenticateLibraryServiceCredential } from "../evidenceLibraries/credentials";
import { readEvidenceLibraryAdminLaunchTarget } from "../evidenceLibraries/setupRecords";
import { createError } from "../lib/errors";

export const replaceFromLibrary = internalMutation({
  args: {
    libraryId: v.string(), credentialDigest: v.string(),
    itemKey: v.string(), revision: v.number(), profileIds: v.array(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    if (!libraryId) throw createError("VALIDATION_ERROR", "Invalid library ID");
    await authenticateLibraryServiceCredential(ctx, {libraryId, credentialDigest: args.credentialDigest});
    if (!/^[A-Z0-9]{8}$/.test(args.itemKey) || !Number.isSafeInteger(args.revision) || args.revision < 1 || args.profileIds.length > 1000) {
      throw createError("VALIDATION_ERROR", "Invalid publication associations");
    }
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    if (!library || library.state === "disabled") throw createError("FORBIDDEN", "Library is unavailable");
    const receipt = await ctx.db.query("authorPublicationReceipts")
      .withIndex("by_libraryId_and_itemKey", q => q.eq("libraryId", libraryId).eq("itemKey", args.itemKey)).unique();
    if (receipt && receipt.revision >= args.revision) return null;
    const profileIds = new Set(args.profileIds.map(value => {
      const id = ctx.db.normalizeId("authorProfiles", value);
      if (!id) throw createError("VALIDATION_ERROR", "Invalid author profile ID");
      return id;
    }));
    for (const profileId of profileIds) {
      if (!await ctx.db.get("authorProfiles", profileId)) throw createError("NOT_FOUND", "Author profile not found");
    }
    const previous = await ctx.db.query("authorPublications")
      .withIndex("by_libraryId_and_itemKey", q => q.eq("libraryId", libraryId).eq("itemKey", args.itemKey)).collect();
    for (const association of previous) {
      if (profileIds.delete(association.profileId)) continue;
      await ctx.db.delete("authorPublications", association._id);
    }
    for (const profileId of profileIds) {
      await ctx.db.insert("authorPublications", {profileId, libraryId, itemKey: args.itemKey});
    }
    if (receipt) await ctx.db.patch("authorPublicationReceipts", receipt._id, {revision: args.revision});
    else await ctx.db.insert("authorPublicationReceipts", {libraryId, itemKey: args.itemKey, revision: args.revision});
    return null;
  },
});

export const list = query({
  args: {profileId: v.id("authorProfiles")},
  handler: async (ctx, {profileId}) => {
    const references = await ctx.db.query("authorPublications").withIndex("by_profileId", q => q.eq("profileId", profileId)).take(1000);
    const libraries = new Map<Id<"evidenceLibraries">, {id: Id<"evidenceLibraries">; name: string; url: string}>();
    for (const libraryId of new Set(references.map(reference => reference.libraryId))) {
      const library = await ctx.db.get("evidenceLibraries", libraryId);
      if (!library) continue;
      const url = await readEvidenceLibraryAdminLaunchTarget(ctx, library);
      if (url) libraries.set(libraryId, {id: libraryId, name: library.name, url});
    }
    return references.flatMap(reference => {
      const library = libraries.get(reference.libraryId);
      return library ? [{id: reference._id, itemKey: reference.itemKey, rank: reference.rank, library}] : [];
    });
  },
});
