import { requireOrganizationFeature } from "../organizationFeatures";
import { paginationOptsValidator, paginationResultValidator, type PaginationOptions } from "convex/server";
import schema from "../schema";
import { v, type Infer } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "../lib/functions";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { authorContentFields } from "./validators";
import { profileRole, requireProfileAccess } from "./access";

export function cleanContent(content: { [K in keyof typeof authorContentFields]: string }) {
  const next = {...content};
  for (const key of Object.keys(next) as (keyof typeof next)[]) {
    next[key] = next[key].trim();
    if (next[key].length > (key === "bio" ? 12000 : 500)) throw createError("VALIDATION_ERROR", `${key} is too long`);
  }
  if (!next.name) throw createError("VALIDATION_ERROR", "Enter an author name");
  for (const key of ["website", "linkedin"] as const) {
    if (!next[key]) continue;
    try {
      const url = new URL(next[key]);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      next[key] = url.href;
    } catch { throw createError("VALIDATION_ERROR", `Enter a valid ${key} URL`); }
  }
  next.orcid = next.orcid.replace(/^https:\/\/orcid.org\//, "");
  if (next.orcid && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(next.orcid)) throw createError("VALIDATION_ERROR", "Enter a valid ORCID");
  next.openalex = next.openalex.replace(/^https:\/\/openalex.org\//, "");
  if (next.openalex && !/^A\d+$/.test(next.openalex)) throw createError("VALIDATION_ERROR", "Choose an OpenAlex author");
  return next;
}

export async function createProfile(ctx: MutationCtx, ownerId: Id<"users">, name: string) {
  const content = cleanContent({name, headline: "", affiliation: "", bio: "", website: "", linkedin: "", orcid: "", openalex: ""});
  return await ctx.db.insert("authorProfiles", {...content, ownerId, revision: 1, updatedAt: Date.now()});
}

/** A profile as pages show it, with its photo's URL. */
const profileWithPhoto = {...schema.doc("authorProfiles").fields, photo: v.union(v.string(), v.null())};

export const create = mutation({
  args: {name: v.string()},
  returns: v.id("authorProfiles"),
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    await requireOrganizationFeature(ctx, "authors");
    return await createProfile(ctx, user._id, args.name);
  },
});

export const get = query({
  args: {profileId: v.string()},
  returns: v.union(v.null(), v.object({...profileWithPhoto, role: v.union(v.literal("owner"), v.literal("editor"), v.null())})),
  handler: async (ctx, {profileId}) => {
    const id = ctx.db.normalizeId("authorProfiles", profileId);
    if (!id) return null;
    const profile = await ctx.db.get("authorProfiles", id);
    if (!profile) return null;
    return {...profile, photo: profile.photoId ? await ctx.storage.getUrl(profile.photoId) : null, role: await profileRole(ctx, profile)};
  },
});

export function searchProfilePage(ctx: QueryCtx, term: string, paginationOpts: PaginationOptions) {
  const search = term.trim().slice(0, 200);
  const query = search
    ? ctx.db.query("authorProfiles").withSearchIndex("search_name", q => q.search("name", search))
    : ctx.db.query("authorProfiles").order("desc");
  return query.paginate({...paginationOpts, numItems: Math.max(1, Math.min(30, Math.floor(paginationOpts.numItems)))});
}

export const list = query({
  args: {search: v.string(), paginationOpts: paginationOptsValidator},
  returns: paginationResultValidator(v.object(profileWithPhoto)),
  handler: async (ctx, args) => {
    await requireOrganizationFeature(ctx, "authors");
    const rows = await searchProfilePage(ctx, args.search, args.paginationOpts);
    return {...rows, page: await Promise.all(rows.page.map(async profile => ({...profile, photo: profile.photoId ? await ctx.storage.getUrl(profile.photoId) : null})))};
  },
});

const contentValidator = v.object(authorContentFields);
async function saveContent(ctx: MutationCtx, args: {profileId: Id<"authorProfiles">; expectedRevision: number; content: Infer<typeof contentValidator>; photo?: {storageId?: Id<"_storage">}; featured?: Id<"authorPublications">[]}) {
  const {profile} = await requireProfileAccess(ctx, args.profileId);
  if (profile.revision !== args.expectedRevision) throw createError("CONFLICT", "This profile changed while you were editing. Reload it before saving.");
  if (args.featured) {
    if (args.featured.length > 1000 || new Set(args.featured).size !== args.featured.length) throw createError("VALIDATION_ERROR", "Invalid publication selection");
    const associations = await ctx.db.query("authorPublications").withIndex("by_profileId", q => q.eq("profileId", args.profileId)).collect();
    const available = new Set(associations.map(row => row._id));
    if (args.featured.some(id => !available.has(id))) throw createError("VALIDATION_ERROR", "Only associated publications can be selected");
    const ranks = new Map(args.featured.map((id, rank) => [id, rank]));
    for (const association of associations) {
      const rank = ranks.get(association._id);
      if (association.rank !== rank) await ctx.db.patch("authorPublications", association._id, {rank});
    }
  }
  const revision = profile.revision + 1;
  const content = cleanContent(args.content);
  await ctx.db.patch("authorProfiles", args.profileId, {...content, revision, updatedAt: Date.now(), ...(args.photo ? {photoId: args.photo.storageId} : {})});
  return {...content, revision};
}

export const editable = internalQuery({
  args: {profileId: v.id("authorProfiles")},
  handler: async (ctx, {profileId}) => (await requireProfileAccess(ctx, profileId)).profile,
});

export const saveWithPhoto = internalMutation({
  args: {profileId: v.id("authorProfiles"), expectedRevision: v.number(), content: v.object(authorContentFields), photo: v.optional(v.object({storageId: v.optional(v.id("_storage"))})), featured: v.optional(v.array(v.id("authorPublications")))},
  returns: v.object({...authorContentFields, revision: v.number()}),
  handler: saveContent,
});
