import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internalQuery, internalMutation } from "../lib/functions";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { readLibrarySessionAccess } from "../evidenceLibraries/sessionAccess";
import { createError } from "../lib/errors";
import { createProfile, searchProfilePage } from "./profiles";
import type { Doc } from "../_generated/dataModel";
import { authenticateLibraryServiceCredential } from "../evidenceLibraries/credentials";

async function publicProfile(ctx: QueryCtx, profile: Doc<"authorProfiles">) {
  return {
    id: profile._id, revision: profile.revision, name: profile.name,
    headline: profile.headline, affiliation: profile.affiliation, bio: profile.bio,
    website: profile.website, linkedin: profile.linkedin, orcid: profile.orcid, openalex: profile.openalex,
    photo: profile.photoId ? await ctx.storage.getUrl(profile.photoId) : null,
  };
}

/** Public profile content, read by a library without requiring a reader account. */
export const resolve = internalQuery({
  args: {libraryId: v.string(), credentialDigest: v.string(), profileIds: v.array(v.string())},
  handler: async (ctx, args) => {
    const libraryId = ctx.db.normalizeId("evidenceLibraries", args.libraryId);
    if (!libraryId || args.profileIds.length > 100) throw createError("VALIDATION_ERROR", "Invalid profile request");
    await authenticateLibraryServiceCredential(ctx, {libraryId, credentialDigest: args.credentialDigest});
    const library = await ctx.db.get("evidenceLibraries", libraryId);
    const organization = library && await ctx.db.get("organizations", library.organizationId);
    if (library?.state !== "active" || organization?.state !== "active") throw createError("FORBIDDEN", "Library is unavailable");
    const profiles = await Promise.all([...new Set(args.profileIds)].map(async value => {
      const id = ctx.db.normalizeId("authorProfiles", value);
      const profile = id ? await ctx.db.get("authorProfiles", id) : null;
      return profile ? await publicProfile(ctx, profile) : null;
    }));
    return profiles.filter(profile => profile !== null);
  },
});

const serviceArgs = {libraryId: v.string(), clerkUserId: v.string(), credentialDigest: v.string()};
async function requireLibraryUser(ctx: QueryCtx | MutationCtx, args: {libraryId: string; clerkUserId: string; credentialDigest: string}) {
  if (!await readLibrarySessionAccess(ctx, args)) throw createError("FORBIDDEN", "Library access required");
  const user = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", args.clerkUserId)).unique();
  if (!user || user.state !== "active") throw createError("FORBIDDEN", "Active OpenScholar account required");
  return user;
}

export const search = internalQuery({
  args: {...serviceArgs, search: v.string(), paginationOpts: paginationOptsValidator},
  handler: async (ctx, args) => {
    await requireLibraryUser(ctx, args);
    const rows = await searchProfilePage(ctx, args.search, args.paginationOpts);
    return {
      profiles: await Promise.all(rows.page.map(profile => publicProfile(ctx, profile))),
      isDone: rows.isDone,
      continueCursor: rows.isDone ? null : rows.continueCursor,
    };
  },
});

export const create = internalMutation({
  args: {...serviceArgs, name: v.string()},
  handler: async (ctx, args) => {
    const user = await requireLibraryUser(ctx, args);
    const id = await createProfile(ctx, user._id, args.name);
    const profile = await ctx.db.get("authorProfiles", id);
    if (!profile) throw createError("NOT_FOUND", "Author profile was not created");
    return {...await publicProfile(ctx, profile), canEdit: true};
  },
});
