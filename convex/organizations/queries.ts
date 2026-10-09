// What the switcher, an organization's Members settings and the join page read (#651).

import { paginationOptsValidator, paginationResultValidator, type PaginationOptions } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { personName } from "../assistant/access";
import { assistantQuery, defineUserQuery, userQuery } from "../lib/userActions";
import { organizationOf } from "./read";

/** An organization's members are counted up to one past this; past it they show as more than it. */
const MEMBERS_COUNTED = 100;
/** The most organizations one page of the switcher's list reads, each with its members counted. */
const WORKSPACES_PAGE = 20;

const roleOf = (role: Doc<"organizationMemberships">["role"]) => (role === "org:admin" ? ("admin" as const) : ("member" as const));
const ROLE = v.union(v.literal("admin"), v.literal("member"));

const workspaceValidator = v.object({
  workspaceId: v.id("workspaces"),
  kind: v.union(v.literal("personal"), v.literal("organization")),
  name: v.string(),
  /** An organization's: the part of the address its pages sit under. */
  slug: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  role: ROLE,
  /** An organization's active members, up to one past MEMBERS_COUNTED. */
  members: v.optional(v.number()),
});

export const workspacesAction = defineUserQuery({
  path: "organizations/queries:workspaces",
  description:
    "Lists the workspaces the person can switch to, a page at a time: their own first, then each organization they're a member of, with their role there and how many members it has. " +
    "`cursor` is `continueCursor` from the page before.",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(workspaceValidator),
  run: async (ctx, { userId }, { paginationOpts }) => {
    const user = await ctx.db.get("users", userId);
    const own = await ctx.db.query("workspaces").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
    if (!user || !own) return { page: [], isDone: true, continueCursor: "" };
    const page = await ctx.db.query("organizationMemberships").withIndex("by_clerkUserId_and_state", (q) => q.eq("clerkUserId", user.clerkId).eq("state", "active")).paginate({ ...paginationOpts, numItems: Math.min(paginationOpts.numItems, WORKSPACES_PAGE) });
    const organizations = await Promise.all(
      page.page.map(async (membership) => {
        const organization = await ctx.db.get("organizations", membership.organizationId);
        const workspace = organization?.state === "active" ? await ctx.db.query("workspaces").withIndex("by_organizationId", (q) => q.eq("organizationId", organization._id)).unique() : null;
        if (!organization || !workspace) return [];
        const members = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organization._id).eq("state", "active")).take(MEMBERS_COUNTED + 1);
        return [{ workspaceId: workspace._id, kind: "organization" as const, name: organization.name, slug: organization.slug, ...(organization.imageUrl ? { imageUrl: organization.imageUrl } : {}), role: roleOf(membership.role), members: members.length }];
      }),
    );
    // The person's own workspace heads the first page.
    const mine = paginationOpts.cursor ? [] : [{ workspaceId: own._id, kind: "personal" as const, name: personName(user) || user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}), role: "admin" as const }];
    return { ...page, page: [...mine, ...organizations.flat()] };
  },
});
export const workspaces = userQuery(workspacesAction, { signedOut: { page: [], isDone: true, continueCursor: "" } });
export const workspacesForAssistant = assistantQuery(workspacesAction);

const memberValidator = v.object({
  userId: v.id("users"),
  name: v.string(),
  email: v.string(),
  imageUrl: v.optional(v.string()),
  role: ROLE,
  you: v.boolean(),
});

/** A member as the list shows them; one whose account isn't projected yet is left out until it is. */
async function memberRow(ctx: QueryCtx, membership: Doc<"organizationMemberships">, you: Id<"users">) {
  const user = await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", membership.clerkUserId)).unique();
  if (!user || user.state !== "active") return null;
  return { userId: user._id, name: personName(user) || user.email, email: user.email, ...(user.avatarUrl ? { imageUrl: user.avatarUrl } : {}), role: roleOf(membership.role), you: user._id === you };
}

export const membersAction = defineUserQuery({
  path: "organizations/queries:members",
  description: "Lists the members of the organization the person is in, a page at a time, each with their name, email and role (admin or member), and which is the person. `cursor` is `continueCursor` from the page before.",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(memberValidator),
  run: async (ctx, { userId, workspaceId }, { paginationOpts }) => {
    const organization = await organizationOf(ctx, workspaceId);
    const page = await ctx.db.query("organizationMemberships").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organization._id).eq("state", "active")).paginate(paginationOpts);
    const rows = await Promise.all(page.page.map((membership) => memberRow(ctx, membership, userId)));
    return { ...page, page: rows.flatMap((row) => (row ? [row] : [])) };
  },
});
export const members = userQuery(membersAction);
export const membersForAssistant = assistantQuery(membersAction);

const invitationValidator = v.object({
  invitationId: v.id("organizationInvitations"),
  email: v.string(),
  role: ROLE,
  sentAt: v.number(),
});

export const invitationsAction = defineUserQuery({
  path: "organizations/queries:invitations",
  description: "Lists the invitations to the organization the person is in that haven't been answered, a page at a time, each with its email, role and when it was sent.",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(invitationValidator),
  run: async (ctx, { workspaceId }, { paginationOpts }) => {
    const organization = await organizationOf(ctx, workspaceId);
    const page = await ctx.db.query("organizationInvitations").withIndex("by_organizationId_and_state", (q) => q.eq("organizationId", organization._id).eq("state", "pending")).order("desc").paginate(paginationOpts);
    return { ...page, page: page.page.map((invitation) => ({ invitationId: invitation._id, email: invitation.email, role: roleOf(invitation.role), sentAt: invitation.clerkCreatedAt })) };
  },
});
export const invitations = userQuery(invitationsAction);
export const invitationsForAssistant = assistantQuery(invitationsAction);

const myInvitationValidator = v.object({
  invitationId: v.id("organizationInvitations"),
  /** Clerk's ID for it, which Clerk's own client accepts. */
  clerkInvitationId: v.string(),
  organization: v.object({ name: v.string(), slug: v.string(), imageUrl: v.optional(v.string()) }),
  role: ROLE,
  /** Who sent it, when it's known. */
  invitedBy: v.optional(v.object({ name: v.string(), imageUrl: v.optional(v.string()) })),
  sentAt: v.number(),
});

/** A page of the person's pending invitations, newest first, each with what the switcher and the join page show. */
async function invitationsTo(ctx: QueryCtx, user: Doc<"users">, paginationOpts: PaginationOptions) {
  const page = await ctx.db.query("organizationInvitations").withIndex("by_email_and_state", (q) => q.eq("email", user.email.toLowerCase()).eq("state", "pending")).order("desc").paginate(paginationOpts);
  const shown = await Promise.all(
    page.page.map(async (invitation) => {
      const organization = await ctx.db.get("organizations", invitation.organizationId);
      if (organization?.state !== "active") return [];
      const inviter = invitation.inviterClerkUserId ? await ctx.db.query("users").withIndex("by_clerk_id", (q) => q.eq("clerkId", invitation.inviterClerkUserId!)).unique() : null;
      return [{
        invitationId: invitation._id,
        clerkInvitationId: invitation.clerkInvitationId,
        organization: { name: organization.name, slug: organization.slug, ...(organization.imageUrl ? { imageUrl: organization.imageUrl } : {}) },
        role: roleOf(invitation.role),
        ...(inviter ? { invitedBy: { name: personName(inviter) || inviter.email, ...(inviter.avatarUrl ? { imageUrl: inviter.avatarUrl } : {}) } } : {}),
        sentAt: invitation.clerkCreatedAt,
      }];
    }),
  );
  return { ...page, page: shown.flat() };
}

export const myInvitationsAction = defineUserQuery({
  path: "organizations/queries:myInvitations",
  description:
    "Lists the invitations the person was sent to join organizations that they haven't answered, a page at a time, each with the organization, the role and who sent it. " +
    "They decline one with organizations/manage:declineInvitation; accepting is theirs to do on the page. `cursor` is `continueCursor` from the page before.",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(myInvitationValidator),
  run: async (ctx, { userId }, { paginationOpts }) => {
    const user = await ctx.db.get("users", userId);
    return user ? await invitationsTo(ctx, user, paginationOpts) : { page: [], isDone: true, continueCursor: "" };
  },
});
export const myInvitations = userQuery(myInvitationsAction, { signedOut: { page: [], isDone: true, continueCursor: "" } });
export const myInvitationsForAssistant = assistantQuery(myInvitationsAction);
