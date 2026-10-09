import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { createError } from "../lib/errors";

/** The organization a workspace is, or why it's refused: a person's own workspace is no organization. */
export async function organizationOf(ctx: Pick<QueryCtx, "db">, workspaceId: Id<"workspaces">): Promise<Doc<"organizations">> {
  const workspace = await ctx.db.get("workspaces", workspaceId);
  const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
  if (!organization || organization.state !== "active") throw createError("VALIDATION_ERROR", "This is the person's own workspace, not an organization.");
  return organization;
}

/** A person's active membership of an organization, or null. */
export async function membershipOf(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">, clerkUserId: string) {
  return await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_clerkUserId_and_state", (q) => q.eq("organizationId", organizationId).eq("clerkUserId", clerkUserId).eq("state", "active"))
    .first();
}

/** Whether `clerkUserId` is the organization's only active admin, whom it can't lose. */
export async function onlyAdmin(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">, clerkUserId: string) {
  const admins = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_state_and_role", (q) => q.eq("organizationId", organizationId).eq("state", "active").eq("role", "org:admin"))
    .take(2);
  return admins.length === 1 && admins[0].clerkUserId === clerkUserId;
}

const placeValidator = v.object({ clerkOrganizationId: v.string(), organizationId: v.id("organizations"), slug: v.string(), name: v.string() });

/** What a change to an organization's people needs: the acting person's Clerk ID, and the organization's. */
export const context = internalQuery({
  args: { userId: v.id("users"), workspaceId: v.id("workspaces") },
  returns: v.object({ clerkUserId: v.string(), email: v.string(), organization: v.union(placeValidator, v.null()) }),
  handler: async (ctx, { userId, workspaceId }) => {
    const user = await ctx.db.get("users", userId);
    if (!user) throw createError("UNAUTHENTICATED", "Authentication required");
    const workspace = await ctx.db.get("workspaces", workspaceId);
    const organization = workspace?.kind === "organization" ? await organizationOf(ctx, workspaceId) : null;
    return {
      clerkUserId: user.clerkId,
      email: user.email.toLowerCase(),
      organization: organization && { clerkOrganizationId: organization.clerkOrganizationId, organizationId: organization._id, slug: organization.slug, name: organization.name },
    };
  },
});

/**
 * Checks a change to someone's place in an organization before Clerk is asked: an admin
 * changes or removes anyone, a member only leaves, and nobody takes away its only admin.
 * Returns the Clerk ID of the person changed.
 */
export const checkMemberChange = internalQuery({
  args: { workspaceId: v.id("workspaces"), actorClerkUserId: v.string(), actorIsAdmin: v.boolean(), userId: v.id("users"), becomes: v.union(v.literal("org:admin"), v.literal("org:member"), v.literal("gone")) },
  returns: v.string(),
  handler: async (ctx, { workspaceId, actorClerkUserId, actorIsAdmin, userId, becomes }) => {
    const organization = await organizationOf(ctx, workspaceId);
    const user = await ctx.db.get("users", userId);
    const membership = user && (await membershipOf(ctx, organization._id, user.clerkId));
    if (!user || !membership) throw createError("NOT_FOUND", "This person isn't a member of the organization.");
    const self = user.clerkId === actorClerkUserId;
    if (!actorIsAdmin && !(self && becomes === "gone")) throw createError("FORBIDDEN", "Only an admin of the organization changes its members.");
    if (membership.role === "org:admin" && becomes !== "org:admin" && (await onlyAdmin(ctx, organization._id, user.clerkId))) {
      throw createError("VALIDATION_ERROR", self ? "You're its only admin: make someone else an admin first." : "This is its only admin: make someone else an admin first.");
    }
    return user.clerkId;
  },
});

/** Refuses deleting an organization that still has an Evidence Library, which has to be moved or deleted first. */
export const checkDeletion = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  returns: v.null(),
  handler: async (ctx, { workspaceId }) => {
    const library = await ctx.db.query("evidenceLibraries").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).first();
    if (library) throw createError("VALIDATION_ERROR", `This organization has an Evidence Library, ${library.name}. Move or delete it first.`);
    return null;
  },
});

/** An invitation the person may answer: a pending one to their own email. */
export const invitationFor = internalQuery({
  args: { invitationId: v.id("organizationInvitations"), email: v.string() },
  returns: v.object({ clerkInvitationId: v.string(), clerkOrganizationId: v.string() }),
  handler: async (ctx, { invitationId, email }) => {
    const invitation = await ctx.db.get("organizationInvitations", invitationId);
    const organization = invitation && (await ctx.db.get("organizations", invitation.organizationId));
    if (!invitation || !organization || invitation.email !== email || invitation.state !== "pending") throw createError("NOT_FOUND", "This invitation is no longer open.");
    return { clerkInvitationId: invitation.clerkInvitationId, clerkOrganizationId: organization.clerkOrganizationId };
  },
});

/** A pending invitation of the organization, for an admin to take back. */
export const pendingInvitation = internalQuery({
  args: { invitationId: v.id("organizationInvitations"), organizationId: v.id("organizations") },
  returns: v.string(),
  handler: async (ctx, { invitationId, organizationId }) => {
    const invitation = await ctx.db.get("organizationInvitations", invitationId);
    if (!invitation || invitation.organizationId !== organizationId || invitation.state !== "pending") throw createError("NOT_FOUND", "This invitation is no longer open.");
    return invitation.clerkInvitationId;
  },
});

/** The workspace of an organization projected from Clerk. */
export const workspaceOf = internalQuery({
  args: { clerkOrganizationId: v.string() },
  returns: v.union(v.object({ workspaceId: v.id("workspaces"), slug: v.string() }), v.null()),
  handler: async (ctx, { clerkOrganizationId }) => {
    const organization = await ctx.db.query("organizations").withIndex("by_clerkOrganizationId", (q) => q.eq("clerkOrganizationId", clerkOrganizationId)).unique();
    const workspace = organization && (await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organization._id)).unique());
    return organization && workspace ? { workspaceId: workspace._id, slug: organization.slug } : null;
  },
});
