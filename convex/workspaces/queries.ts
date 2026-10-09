import { v } from "convex/values";
import { query } from "../lib/functions";
import { getCurrentUser } from "../lib/auth";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { MAX_ORGANIZATIONS_PER_PERSON } from "../lib/queryBounds";
import { actorIn, personalWorkspaceOf } from "./actor";

/** The signed-in person's own workspace, which a page outside /o/<slug> is in; null when signed out. */
export const personal = query({
  args: {},
  returns: v.union(v.id("workspaces"), v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user ? await personalWorkspaceOf(ctx, user._id) : null;
  },
});

/**
 * The workspace of the organization a page's address names (/o/<slug>, #651), for a person who is
 * an active member of it; null for anyone else, so nobody outside it learns it exists.
 */
export const bySlug = query({
  args: { slug: v.string() },
  returns: v.union(v.id("workspaces"), v.null()),
  handler: async (ctx, { slug }) => {
    const user = await getCurrentUser(ctx);
    const organization = user ? await ctx.db.query("organizations").withIndex("by_slug", (q) => q.eq("slug", slug)).first() : null;
    if (!user || organization?.state !== "active") return null;
    const membership = await ctx.db
      .query("organizationMemberships")
      .withIndex("by_organizationId_and_clerkUserId_and_state", (q) => q.eq("organizationId", organization._id).eq("clerkUserId", user.clerkId).eq("state", "active"))
      .first();
    if (!membership) return null;
    return (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organization._id)).unique())?._id ?? null;
  },
});

const itemKind = v.union(v.literal("search"), v.literal("screening"), v.literal("extraction"), v.literal("collection"), v.literal("library"), v.literal("profile"));

/** The workspaces a person acts in: their own, then their organizations'. */
async function workspacesOf(ctx: QueryCtx, user: Doc<"users">) {
  const memberships = await ctx.db.query("organizationMemberships").withIndex("by_clerkUserId_and_state", (q) => q.eq("clerkUserId", user.clerkId).eq("state", "active")).take(MAX_ORGANIZATIONS_PER_PERSON);
  const organizations = await Promise.all(memberships.map((membership) => ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", membership.organizationId)).unique()));
  return [await personalWorkspaceOf(ctx, user._id), ...organizations.flatMap((workspace) => (workspace ? [workspace._id] : []))];
}

/** The workspace an item a page's address names is in, or null when there's none such. */
async function itemWorkspace(ctx: QueryCtx, user: Doc<"users">, kind: "search" | "screening" | "extraction" | "collection" | "library" | "profile", id: string, here: Id<"workspaces">): Promise<Id<"workspaces"> | null> {
  if (kind === "search") {
    // A search's address carries its ID within its workspace, which two workspaces may share: the one the page is in comes first.
    for (const workspaceId of [here, ...(await workspacesOf(ctx, user)).filter((workspace) => workspace !== here)]) {
      const search = await ctx.db.query("searches").withIndex("by_workspace_and_localId", (q) => q.eq("workspaceId", workspaceId).eq("localId", id)).first();
      if (search) return workspaceId;
    }
    return null;
  }
  const table = ({ screening: "screeningJobs", extraction: "extractionJobs", collection: "collections", library: "evidenceLibraries", profile: "authorProfiles" } as const)[kind];
  const docId = ctx.db.normalizeId(table, id);
  const item = docId ? await ctx.db.get(docId) : null;
  return item && "workspaceId" in item && item.workspaceId ? item.workspaceId : null;
}

/**
 * Where an item a page's address names lives (#651): an organization's slug, or none for the
 * person's own workspace. Null when it's in no workspace they act in, so the page answers as it would.
 */
export const homeOf = query({
  args: { kind: itemKind, id: v.string(), here: v.id("workspaces") },
  returns: v.union(v.object({ slug: v.optional(v.string()) }), v.null()),
  handler: async (ctx, { kind, id, here }) => {
    const user = await getCurrentUser(ctx);
    const workspaceId = user ? await itemWorkspace(ctx, user, kind, id, here) : null;
    if (!user || !workspaceId || !(await actorIn(ctx, user, workspaceId))) return null;
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (workspace?.kind !== "organization") return {};
    const organization = await ctx.db.get("organizations", workspace.organizationId);
    return organization ? { slug: organization.slug } : null;
  },
});
