import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { seatSyncRow } from "../billing/seatSyncs";
import { readAccount } from "../billing/accounts";
import { internalMutation } from "../lib/functions";
import { createError } from "../lib/errors";
import { MAX_ORGANIZATION_MEMBERS } from "../lib/queryBounds";
import { searchTerms } from "../lib/searchText";
import { FREE_MEMBERS, TEAM_PLAN } from "../../lib/billing/plans";

/** Invitations past an organization's room that one read names, for whoever takes them back a few at a time. */
export const PAST_ROOM_STEP = 10;

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

/** Members an email's words match that a check compares with it. */
const MEMBERS_MATCHED = 20;

/**
 * Whether someone with this email is an active member of the organization. Clerk keeps an email
 * in the case it was given: the members are searched by its words, and compared whatever the case.
 */
export async function memberWithEmail(ctx: Pick<QueryCtx, "db">, organizationId: Id<"organizations">, email: string) {
  const wanted = email.trim().toLowerCase();
  const terms = searchTerms(wanted);
  if (!terms) return false;
  const found = await ctx.db.query("organizationMemberships").withSearchIndex("search_member_text", (q) => q.search("searchText", terms).eq("organizationId", organizationId).eq("state", "active")).take(MEMBERS_MATCHED);
  for (const membership of found) {
    const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique();
    if (user && user.state !== "deleted" && user.email.toLowerCase() === wanted) return true;
  }
  return false;
}

/** An address's waiting invitations one read looks through for this organization's: someone is rarely invited to many at once. */
const INVITATIONS_MATCHED = 50;

/**
 * Which of these addresses can't be invited to the organization: a member's, or one with an
 * invitation to it waiting. Clerk refuses a whole request for one such address, so the request
 * leaves them out.
 */
export const alreadyIn = internalQuery({
  args: { workspaceId: v.id("workspaces"), emails: v.array(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, { workspaceId, emails }) => {
    const organization = await organizationOf(ctx, workspaceId);
    const known = await Promise.all(
      emails.map(async (email) => {
        const waiting = await ctx.db.query("organizationInvitations").withIndex("by_email_and_state", (q) => q.eq("email", email).eq("state", "pending")).take(INVITATIONS_MATCHED);
        return waiting.some((invitation) => invitation.organizationId === organization._id) || (await memberWithEmail(ctx, organization._id, email));
      }),
    );
    return emails.filter((_, at) => known[at]);
  },
});

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
 * One that takes an admin away holds its admins until `endMemberChange`, and is refused while
 * another holds them: Clerk lets two made at the same moment each take the other's place.
 * Returns the Clerk ID of the person changed, and the hold when it took one.
 */
export const beginMemberChange = internalMutation({
  args: { workspaceId: v.id("workspaces"), actorClerkUserId: v.string(), userId: v.id("users"), becomes: v.union(v.literal("org:admin"), v.literal("org:member"), v.literal("gone")) },
  returns: v.object({ target: v.string(), heldAt: v.optional(v.number()) }),
  handler: async (ctx, { workspaceId, actorClerkUserId, userId, becomes }) => {
    const organization = await organizationOf(ctx, workspaceId);
    const user = await ctx.db.get("users", userId);
    const membership = user && (await membershipOf(ctx, organization._id, user.clerkId));
    if (!user || !membership) throw createError("NOT_FOUND", "This person isn't a member of the organization.");
    const self = user.clerkId === actorClerkUserId;
    // Read with the change: the role the action started with may be one another change just took away.
    const actorIsAdmin = self ? membership.role === "org:admin" : (await membershipOf(ctx, organization._id, actorClerkUserId))?.role === "org:admin";
    if (!actorIsAdmin && !(self && becomes === "gone")) throw createError("FORBIDDEN", "Only an admin of the organization changes its members.");
    if (membership.role !== "org:admin" || becomes === "org:admin") return { target: user.clerkId };
    if (await onlyAdmin(ctx, organization._id, user.clerkId)) {
      throw createError("VALIDATION_ERROR", self ? "You're its only admin: make someone else an admin first." : "This is its only admin: make someone else an admin first.");
    }
    const heldAt = Date.now();
    if (organization.adminChangeAt !== undefined && heldAt - organization.adminChangeAt < ADMIN_CHANGE_HOLD_MS) throw createError("CONFLICT", "Another change to its admins is under way. Try again in a moment.");
    await ctx.db.patch("organizations", organization._id, { adminChangeAt: heldAt });
    return { target: user.clerkId, heldAt };
  },
});

/** Lets the organization's admins be changed again, once the change that held them is kept or failed. */
export const endMemberChange = internalMutation({
  args: { workspaceId: v.id("workspaces"), heldAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { workspaceId, heldAt }) => {
    const workspace = await ctx.db.get("workspaces", workspaceId);
    const organization = workspace?.kind === "organization" ? await ctx.db.get("organizations", workspace.organizationId) : null;
    if (organization?.adminChangeAt === heldAt) await ctx.db.patch("organizations", organization._id, { adminChangeAt: undefined });
    return null;
  },
});

/** How long a change to its admins holds them, at most, should the action that started it never finish. */
const ADMIN_CHANGE_HOLD_MS = 60_000;

/** How long a deletion holds its organization, at most, should the action that started it never finish. */
const DELETION_HOLD_MS = 5 * 60_000;

/** The organization of a workspace, refused while something stops it being deleted: a deletion under way, an Evidence Library, or a plan that renews. */
export async function deletable(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const organization = await organizationOf(ctx, workspaceId);
  if (organization.deletingAt !== undefined) throw createError("CONFLICT", "This organization is being deleted already.");
  const library = await ctx.db.query("evidenceLibraries").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).first();
  if (library) throw createError("VALIDATION_ERROR", `This organization has an Evidence Library, ${library.name}. Move or delete it first.`);
  return organization;
}

/**
 * Starts deleting an organization, refused while it has an Evidence Library, which has to be
 * moved or deleted first. From here nobody acts in its workspace (../workspaces/actor.ts), so no
 * library can be made before Clerk deletes it.
 */
export const beginDeletion = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.number(),
  handler: async (ctx, { workspaceId }) => {
    const organization = await deletable(ctx, workspaceId);
    const deletingAt = Date.now();
    await ctx.db.patch("organizations", organization._id, { deletingAt });
    await ctx.scheduler.runAfter(DELETION_HOLD_MS, internal.organizations.read.endDeletion, { organizationId: organization._id, deletingAt });
    return deletingAt;
  },
});

/**
 * Closes an organization Clerk has deleted, at once: nothing reopens it then, though the event
 * that also ends its memberships, kept next or sent by Clerk's webhook, comes after.
 */
export const deletedInClerk = internalMutation({
  args: { organizationId: v.id("organizations") },
  returns: v.null(),
  handler: async (ctx, { organizationId }) => {
    await ctx.db.patch("organizations", organizationId, { state: "deleted", updatedAt: Date.now() });
    return null;
  },
});

/** Lets an organization whose deletion didn't go through be worked in again. */
export const endDeletion = internalMutation({
  args: { organizationId: v.id("organizations"), deletingAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { organizationId, deletingAt }) => {
    const organization = await ctx.db.get("organizations", organizationId);
    if (organization?.state === "active" && organization.deletingAt === deletingAt) await ctx.db.patch("organizations", organizationId, { deletingAt: undefined });
    return null;
  },
});

/** Marks an invitation expired once its link has, unless it was answered first. */
export const expireInvitation = internalMutation({
  args: { invitationId: v.id("organizationInvitations") },
  returns: v.null(),
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get("organizationInvitations", invitationId);
    if (invitation?.state === "pending") await ctx.db.patch("organizationInvitations", invitationId, { state: "expired", updatedAt: Date.now() });
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
  returns: v.object({ clerkInvitationId: v.string(), email: v.string(), role: v.union(v.literal("org:admin"), v.literal("org:member")) }),
  handler: async (ctx, { invitationId, organizationId }) => {
    const invitation = await ctx.db.get("organizationInvitations", invitationId);
    if (!invitation || invitation.organizationId !== organizationId || invitation.state !== "pending") throw createError("NOT_FOUND", "This invitation is no longer open.");
    return { clerkInvitationId: invitation.clerkInvitationId, email: invitation.email, role: invitation.role };
  },
});

/**
 * Invitations past the room the organization's plan has for members, invitations included (on
 * Team its seats bought, less those held to the renewal: #863), by
 * Clerk's ID: the open ones are counted oldest kept first, so the ones made last are the ones
 * past it. Of `sent` when given, just made; else the first few of them all.
 */
export const pastRoom = internalQuery({
  args: { workspaceId: v.id("workspaces"), sent: v.optional(v.array(v.string())) },
  returns: v.array(v.string()),
  handler: async (ctx, { workspaceId, sent }) => {
    const organization = await organizationOf(ctx, workspaceId);
    const seats = await seatSyncRow(ctx, workspaceId);
    const limit = (await readAccount(ctx, workspaceId))?.plan === TEAM_PLAN ? (seats?.seats ?? 0) - (seats?.held ?? 0) : FREE_MEMBERS;
    const members = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organization._id).eq("state", "active")).take(MAX_ORGANIZATION_MEMBERS);
    const room = Math.max(0, limit - members.length);
    // The ones with room, and the first few past it: whatever of `sent` isn't among the first is past it too.
    const open = await ctx.db.query("organizationInvitations").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organization._id).eq("state", "pending")).take(Math.min(MAX_ORGANIZATION_MEMBERS + PAST_ROOM_STEP, room + PAST_ROOM_STEP));
    const within = new Set(open.slice(0, room).map((invitation) => invitation.clerkInvitationId));
    return sent ? sent.filter((id) => !within.has(id)) : open.slice(room).map((invitation) => invitation.clerkInvitationId);
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

/** The organization at an address, or null: a deleted one's address can be another's since. */
export const organizationAt = (ctx: QueryCtx, slug: string) =>
  ctx.db.query("organizations").withIndex("by_slug_and_state", (q) => q.eq("slug", slug).eq("state", "active")).first();

/** The Clerk ID of the organization at an address, or null. */
export const clerkIdOf = internalQuery({
  args: { slug: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { slug }) => (await organizationAt(ctx, slug))?.clerkOrganizationId ?? null,
});

