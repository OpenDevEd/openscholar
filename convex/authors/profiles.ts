import { paginationOptsValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { authorContentFields } from "./validators";
import { profileRole, requireProfileAccess } from "./access";

function cleanContent(content: { [K in keyof typeof authorContentFields]: string }) {
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

export const create = mutation({
  args: {name: v.string()},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const content = cleanContent({name: args.name, headline: "", affiliation: "", bio: "", website: "", linkedin: "", orcid: "", openalex: ""});
    return await ctx.db.insert("authorProfiles", {...content, ownerId: user._id, revision: 1, updatedAt: Date.now()});
  },
});

export const get = query({
  args: {profileId: v.string()},
  handler: async (ctx, {profileId}) => {
    const id = ctx.db.normalizeId("authorProfiles", profileId);
    if (!id) return null;
    const profile = await ctx.db.get("authorProfiles", id);
    if (!profile) return null;
    return {...profile, photo: profile.photoId ? await ctx.storage.getUrl(profile.photoId) : null, role: await profileRole(ctx, profile)};
  },
});

export const list = query({
  args: {search: v.string(), paginationOpts: paginationOptsValidator},
  handler: async (ctx, args) => {
    const search = args.search.trim().slice(0, 200);
    const rows = search
      ? await ctx.db.query("authorProfiles").withSearchIndex("search_name", q => q.search("name", search)).paginate(args.paginationOpts)
      : await ctx.db.query("authorProfiles").order("desc").paginate(args.paginationOpts);
    return {...rows, page: await Promise.all(rows.page.map(async profile => ({...profile, photo: profile.photoId ? await ctx.storage.getUrl(profile.photoId) : null})))};
  },
});

const contentValidator = v.object(authorContentFields);
async function saveContent(ctx: MutationCtx, args: {profileId: Id<"authorProfiles">; expectedRevision: number; content: Infer<typeof contentValidator>; photo?: {storageId?: Id<"_storage">}}) {
  const {profile} = await requireProfileAccess(ctx, args.profileId);
  if (profile.revision !== args.expectedRevision) throw createError("CONFLICT", "This profile changed while you were editing. Reload it before saving.");
  const revision = profile.revision + 1;
  await ctx.db.patch("authorProfiles", args.profileId, {...cleanContent(args.content), revision, updatedAt: Date.now(), ...(args.photo ? {photoId: args.photo.storageId} : {})});
  return revision;
}

export const update = mutation({
  args: {profileId: v.id("authorProfiles"), expectedRevision: v.number(), content: contentValidator},
  returns: v.number(),
  handler: saveContent,
});

export const editable = internalQuery({
  args: {profileId: v.id("authorProfiles")},
  handler: async (ctx, {profileId}) => (await requireProfileAccess(ctx, profileId)).profile,
});

export const saveWithPhoto = internalMutation({
  args: {profileId: v.id("authorProfiles"), expectedRevision: v.number(), content: v.object(authorContentFields), photo: v.optional(v.object({storageId: v.optional(v.id("_storage"))}))},
  returns: v.number(),
  handler: saveContent,
});
