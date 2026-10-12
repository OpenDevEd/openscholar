import { MAX_AUTHORS_PER_PUBLICATION } from "../lib/queryBounds";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { internalMutation, internalQuery, query, type QueryCtx } from "../lib/functions";
import { AUTHOR_PUBLICATIONS_READ, publicationReferencePageValidator, publicationReferenceValidator } from "./validators";
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
    if (!/^[A-Z0-9]{8}$/.test(args.itemKey) || !Number.isSafeInteger(args.revision) || args.revision < 1 || args.profileIds.length > MAX_AUTHORS_PER_PUBLICATION) {
      throw createError("VALIDATION_ERROR", "Invalid publication associations");
    }
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    if (!library || library.state === "disabled") throw createError("FORBIDDEN", "Library is unavailable");
    const receipt = await ctx.db.query("authorPublicationReceipts")
      .withIndex("by_libraryId_and_itemKey", q => q.eq("libraryId", libraryId).eq("itemKey", args.itemKey)).unique();
    if (receipt && receipt.revision >= args.revision) return null;
    const profileIds = new Set<Id<"authorProfiles">>();
    for (const value of new Set(args.profileIds)) {
      const id = ctx.db.normalizeId("authorProfiles", value);
      if (!id || !await ctx.db.get("authorProfiles", id)) {
        console.error("Ignoring unavailable author profile association", {libraryId, itemKey: args.itemKey, profileId: value});
        continue;
      }
      profileIds.add(id);
    }
    const previous = await ctx.db.query("authorPublications")
      .withIndex("by_libraryId_and_itemKey", q => q.eq("libraryId", libraryId).eq("itemKey", args.itemKey)).take(MAX_AUTHORS_PER_PUBLICATION);
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

/** A profile's publications with the library each is in, where that library can be opened. */
async function withLibraries(ctx: QueryCtx, references: Doc<"authorPublications">[]) {
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
}

export const list = query({
  args: {profileId: v.string()},
  returns: v.array(publicationReferenceValidator),
  handler: async (ctx, args) => {
    const profileId = ctx.db.normalizeId("authorProfiles", args.profileId);
    if (!profileId) return [];
    return await withLibraries(ctx, await ctx.db.query("authorPublications").withIndex("by_profileId", q => q.eq("profileId", profileId)).take(1000));
  },
});

/** A page of a profile's publications, from `cursor`, however many it has (../authors/assistant.ts). */
export const referencePage = internalQuery({
  args: {profileId: v.string(), cursor: v.union(v.string(), v.null())},
  returns: publicationReferencePageValidator,
  handler: async (ctx, {profileId, cursor}) => {
    const id = ctx.db.normalizeId("authorProfiles", profileId);
    if (!id) return {page: [], isDone: true, continueCursor: ""};
    const read = await ctx.db.query("authorPublications").withIndex("by_profileId", q => q.eq("profileId", id)).paginate({numItems: AUTHOR_PUBLICATIONS_READ, cursor});
    return {page: await withLibraries(ctx, read.page), isDone: read.isDone, continueCursor: read.continueCursor};
  },
});
