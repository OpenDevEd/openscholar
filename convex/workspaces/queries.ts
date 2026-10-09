import { v } from "convex/values";
import { query } from "../lib/functions";
import { getCurrentUser } from "../lib/auth";
import { personalWorkspaceOf } from "./actor";

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
