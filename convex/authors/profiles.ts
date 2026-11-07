import { contactPage } from "../../lib/billing/contact";
import { opensLibraries } from "../billing/accounts";
import { searchTerms } from "../lib/searchText";
import { paginationOptsValidator, paginationResultValidator, type PaginationOptions } from "convex/server";
import schema from "../schema";
import { v, type Infer } from "convex/values";
import { query, internalQuery, internalMutation } from "../lib/functions";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { libraryOf, readLibraryRole } from "../evidenceLibraries/access";
import { MAX_LIBRARY_GRANTS_PER_PERSON } from "../lib/queryBounds";
import { give } from "../sharing/access";
import { actorIn } from "../workspaces/actor";
import { createError } from "../lib/errors";
import { authorContentFields } from "./validators";
import { profileViewer, requireProfileAccess } from "./access";
import { workspaceMutation } from "../lib/userActions";
import { noteActivity } from "../activity/notes";
import { moveMainRecord } from "./links";

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
  next.openalex = next.openalex.replace(/^https:\/\/(?:openalex\.org|openscholar\.ai)\//, "");
  if (next.openalex && !/^(?:A|OSA)\d+$/.test(next.openalex)) throw createError("VALIDATION_ERROR", "Choose an author from the list");
  return next;
}

/**
 * A profile owned by `workspaceId`, made by `createdBy` (#650), or by the assistant for them; `community`, the one it's
 * made from, in its admin. Refused unless they may make one there (#1093): the workspace has Evidence Communities on,
 * and they own or run it, or own or edit one of its communities (that one, when it's made from one). Its owners are the
 * workspace's; a maker who isn't one of them edits it.
 */
export async function createProfile(ctx: MutationCtx, createdBy: Id<"users">, workspaceId: Id<"workspaces">, name: string, { viaAssistant = false, community }: { viaAssistant?: boolean; community?: Doc<"evidenceLibraries"> } = {}) {
  await requireAuthorProfiles(ctx, workspaceId);
  const maker = await ctx.db.get("users", createdBy);
  const runs = maker ? (await actorIn(ctx, maker, workspaceId))?.role === "admin" : false;
  if (!maker || (!runs && !(await editsCommunityIn(ctx, maker, workspaceId, community)))) {
    throw createError("FORBIDDEN", "Author profiles are made by a workspace's owners and admins, and by the owners and editors of its communities.");
  }
  const content = cleanContent({name, headline: "", affiliation: "", bio: "", website: "", linkedin: "", orcid: "", openalex: ""});
  const id = await ctx.db.insert("authorProfiles", {...content, workspaceId, createdBy, revision: 1, updatedAt: Date.now()});
  await noteActivity(ctx, {workspaceId, by: createdBy, viaAssistant}, {kind: "author", id, happened: "created", detail: content.name});
  if (!runs) await give(ctx, {kind: "author", id, workspaceId, name: content.name, createdBy}, maker, "editor", {userId: createdBy, author: viaAssistant ? "assistant" : "user"});
  return id;
}

/**
 * Whether a person owns or edits a community in the workspace: `community` when the profile is made from one, by
 * whatever role they have in it; otherwise one they were given the editor's role in themselves.
 */
async function editsCommunityIn(ctx: MutationCtx, user: Doc<"users">, workspaceId: Id<"workspaces">, community?: Doc<"evidenceLibraries">) {
  if (community) {
    const role = community.workspaceId === workspaceId ? await readLibraryRole(ctx, community, user.clerkId) : null;
    return role === "owner" || role === "editor";
  }
  // A person holds at most MAX_LIBRARY_GRANTS_PER_PERSON, which giving them one enforces.
  const grants = await ctx.db.query("itemAccess").withIndex("by_user_and_kind_and_grantedAt", (q) => q.eq("userId", user._id).eq("kind", "library")).take(MAX_LIBRARY_GRANTS_PER_PERSON);
  for (const grant of grants) if (grant.role === "editor" && (await libraryOf(ctx, grant))?.workspaceId === workspaceId) return true;
  return false;
}

/** A profile as pages show it, with its photo's URL. */
const profileWithPhoto = {...schema.doc("authorProfiles").fields, photo: v.union(v.string(), v.null())};

/**
 * Refuses unless `workspaceId` manages author profiles: takes a new one, or one moved into it.
 * Its plan includes Evidence Libraries, which profiles are managed with;
 * a library shared with the person isn't that. A plan is its workspace's alone.
 */
export async function requireAuthorProfiles(ctx: QueryCtx | MutationCtx, workspaceId: Id<"workspaces">) {
  if (!(await opensLibraries(ctx, workspaceId))) throw createError("FORBIDDEN", `Author profiles come with Evidence Communities, which are turned on for a workspace by request. Ask for them at ${contactPage("community")}.`);
}

/** Makes a profile owned by the page's workspace. */
export const create = workspaceMutation({
  args: {name: v.string()},
  returns: v.id("authorProfiles"),
  handler: async (ctx, {userId, workspaceId}, args) => {
    return await createProfile(ctx, userId, workspaceId, args.name);
  },
});

/** A profile by its ID as its public page shows it, with what the reader is to it; null for one that isn't there. */
export async function readProfile(ctx: QueryCtx, profileId: string) {
  const id = ctx.db.normalizeId("authorProfiles", profileId);
  if (!id) return null;
  const profile = await ctx.db.get("authorProfiles", id);
  if (!profile) return null;
  return {...profile, photo: profile.photoId ? await ctx.storage.getUrl(profile.photoId) : null, ...(await profileViewer(ctx, profile))};
}

export const get = query({
  args: {profileId: v.string()},
  returns: v.union(v.null(), v.object({...profileWithPhoto, role: v.union(v.literal("owner"), v.literal("editor"), v.null()), member: v.boolean()})),
  handler: async (ctx, {profileId}) => await readProfile(ctx, profileId),
});

export function searchProfilePage(ctx: QueryCtx, term: string, paginationOpts: PaginationOptions) {
  const search = searchTerms(term.slice(0, 200)) ?? "";
  const query = search
    ? ctx.db.query("authorProfiles").withSearchIndex("search_name", q => q.search("name", search))
    : ctx.db.query("authorProfiles").order("desc");
  return query.paginate({...paginationOpts, numItems: Math.max(1, Math.min(30, Math.floor(paginationOpts.numItems)))});
}

/** Every profile, newest first or the ones whose name matches `search`: public, as each profile's page is (`get`). Making one takes Evidence Libraries (`create`). */
export const list = query({
  args: {search: v.string(), paginationOpts: paginationOptsValidator},
  returns: paginationResultValidator(v.object(profileWithPhoto)),
  handler: async (ctx, args) => {
    const rows = await searchProfilePage(ctx, args.search, args.paginationOpts);
    return {...rows, page: await Promise.all(rows.page.map(async profile => ({...profile, photo: profile.photoId ? await ctx.storage.getUrl(profile.photoId) : null})))};
  },
});

const contentValidator = v.object(authorContentFields);
async function saveContent(ctx: MutationCtx, args: {profileId: Id<"authorProfiles">; expectedRevision: number; content: Infer<typeof contentValidator>; photo?: {storageId?: Id<"_storage">}; featured?: Id<"authorPublications">[]}) {
  const {profile, user} = await requireProfileAccess(ctx, args.profileId);
  if (profile.revision !== args.expectedRevision) throw createError("CONFLICT", "This profile changed while you were editing. Reload it before saving.");
  if (args.featured) {
    if (args.featured.length > 1000 || new Set(args.featured).size !== args.featured.length) throw createError("VALIDATION_ERROR", "Invalid publication selection");
    // Reads only the featured publications and the ones ranked now, never every association.
    const featured = await Promise.all(args.featured.map(id => ctx.db.get("authorPublications", id)));
    if (featured.some(row => row?.profileId !== args.profileId)) throw createError("VALIDATION_ERROR", "Only associated publications can be selected");
    const ranks = new Map(args.featured.map((id, rank) => [id, rank]));
    const ranked = await ctx.db.query("authorPublications").withIndex("by_profileId_and_rank", q => q.eq("profileId", args.profileId).gte("rank", 0)).take(1000);
    for (const association of [...ranked.filter(row => !ranks.has(row._id)), ...featured.map(row => row!)]) {
      const rank = ranks.get(association._id);
      if (association.rank !== rank) await ctx.db.patch("authorPublications", association._id, {rank});
    }
  }
  const revision = profile.revision + 1;
  const content = cleanContent(args.content);
  await moveMainRecord(ctx, args.profileId, profile.openalex, content.openalex);
  await ctx.db.patch("authorProfiles", args.profileId, {...content, revision, updatedAt: Date.now(), ...(args.photo ? {photoId: args.photo.storageId} : {})});
  // Its Activity (#656), kept by the workspace that owns it: a new name says the one it had.
  if (profile.workspaceId) await noteActivity(ctx, {workspaceId: profile.workspaceId, by: user._id, viaAssistant: false}, {kind: "author", id: args.profileId, ...(content.name === profile.name ? {happened: "edited"} : {happened: "renamed", detail: profile.name})});
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
