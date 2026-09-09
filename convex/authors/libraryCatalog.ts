import { v } from "convex/values";
import { internalQuery, internalMutation } from "../_generated/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { readLibrarySessionAccess } from "../evidenceLibraries/sessionAccess";
import { createError } from "../lib/errors";
import { profileRoleForUser } from "./access";
import { cleanContent } from "./profiles";

const serviceArgs = {libraryId: v.string(), clerkUserId: v.string(), credentialDigest: v.string()};
async function requireLibraryUser(ctx: QueryCtx | MutationCtx, args: {libraryId: string; clerkUserId: string; credentialDigest: string}) {
  if (!await readLibrarySessionAccess(ctx, args)) throw createError("FORBIDDEN", "Library access required");
  const user = await ctx.db.query("users").withIndex("by_clerk_id", q => q.eq("clerkId", args.clerkUserId)).unique();
  if (!user || user.state !== "active") throw createError("FORBIDDEN", "Active OpenScholar account required");
  return user;
}

export const search = internalQuery({
  args: {...serviceArgs, search: v.string(), profileId: v.optional(v.string())},
  handler: async (ctx, args) => {
    const user = await requireLibraryUser(ctx, args);
    const id = args.profileId ? ctx.db.normalizeId("authorProfiles", args.profileId) : null;
    const direct = id ? await ctx.db.get("authorProfiles", id) : null;
    const search = args.search.trim().slice(0,200);
    const profiles = args.profileId ? (direct ? [direct] : []) : search
      ? await ctx.db.query("authorProfiles").withSearchIndex("search_name", q => q.search("name", search)).take(30)
      : await ctx.db.query("authorProfiles").order("desc").take(30);
    return await Promise.all(profiles.map(async profile => ({
      id: profile._id, revision: profile.revision, name: profile.name, affiliation: profile.affiliation,
      bio: profile.bio, website: profile.website, orcid: profile.orcid, openalex: profile.openalex,
      canEdit: Boolean(await profileRoleForUser(ctx, profile, user._id)),
    })));
  },
});

export const save = internalMutation({
  args: {...serviceArgs, profileId: v.optional(v.string()), expectedRevision: v.optional(v.number()),
    name: v.string(), affiliation: v.string(), bio: v.string(), website: v.string(), orcid: v.string()},
  handler: async (ctx, args) => {
    const user = await requireLibraryUser(ctx, args);
    const id = args.profileId ? ctx.db.normalizeId("authorProfiles", args.profileId) : null;
    const profile = id ? await ctx.db.get("authorProfiles", id) : null;
    if (args.profileId && !profile) throw createError("NOT_FOUND", "Author profile not found");
    if (profile && !await profileRoleForUser(ctx, profile, user._id)) throw createError("FORBIDDEN", "Profile edit access required");
    if (profile && profile.revision !== args.expectedRevision) throw createError("CONFLICT", "The author profile changed. Reload it before saving.");
    const content = cleanContent({name: args.name, affiliation: args.affiliation, bio: args.bio, website: args.website, orcid: args.orcid,
      headline: profile?.headline ?? "", linkedin: profile?.linkedin ?? "", openalex: profile?.openalex ?? ""});
    if (profile) {
      await ctx.db.patch("authorProfiles", profile._id, {...content, revision: profile.revision+1, updatedAt: Date.now()});
      return profile._id;
    }
    return await ctx.db.insert("authorProfiles", {...content, ownerId: user._id, revision: 1, updatedAt: Date.now()});
  },
});
