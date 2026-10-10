/**
 * Inviting someone to an item by email (#653), for anyone the sharer can't pick by name. The
 * invitation holds a guest's place on the item until it's answered, cancelled or seven days
 * old. Whoever accepts must have the invited address verified on their account, which Clerk
 * confirms (./mail.ts).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../lib/functions";
import { createError } from "../lib/errors";
import { personName } from "../lib/people";
import { MAX_ACCOUNTS_PER_EMAIL, MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL } from "../lib/queryBounds";
import { rateLimit } from "../lib/rateLimit";
import { actingAs, assistantAction, defineChangingAction, userAction } from "../lib/userActions";
import { actorIn } from "../workspaces/actor";
import { workspaceName } from "../workspaces/personal";
import { grantOf, invitationTo, noteShared, requireRoom } from "./access";
import { findShared, kindWord, sharedIn } from "./items";
import { guestRoleValidator, sharedKindValidator } from "./validators";

const WEEK = 7 * 86_400_000;
const actingValidator = { userId: v.id("users"), workspaceId: v.id("workspaces"), author: v.union(v.literal("user"), v.literal("assistant")) };
const invitationArgs = { kind: sharedKindValidator, id: v.string(), email: v.string(), role: guestRoleValidator };

/** Checks an invitation and keeps it, ready to send. Sending one again restarts its seven days and takes no second place. */
export const prepare = internalMutation({
  args: { ...actingValidator, ...invitationArgs },
  returns: v.id("itemInvitations"),
  handler: async (ctx, { userId, workspaceId, author, kind, id, role, ...args }) => {
    const actor = await actingAs(ctx, userId, workspaceId, author);
    const shared = await sharedIn(ctx, actor, kind, id);
    await rateLimit(ctx, { name: "item-invitation", key: String(userId), throws: true });
    const email = args.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError("VALIDATION_ERROR", "Enter a valid email address");
    // A deleted account keeps its address, so one address can name several accounts.
    const accounts = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).take(MAX_ACCOUNTS_PER_EMAIL + 1);
    if (accounts.length > MAX_ACCOUNTS_PER_EMAIL) throw createError("VALIDATION_ERROR", "Too many accounts have used this address to check which of them already has it. Invite a different address.");
    for (const account of accounts) {
      if (account.state !== "active") continue;
      if ((await actorIn(ctx, account, shared.workspaceId)) || (await grantOf(ctx, shared.id, account._id))) throw createError("CONFLICT", "This person has it already.");
    }
    const existing = await invitationTo(ctx, shared.id, email);
    const waits = existing?.state === "pending";
    if (!waits) {
      await requireRoom(ctx, shared);
      const theirs = await ctx.db.query("itemInvitations").withIndex("by_email_and_state", (q) => q.eq("email", email).eq("state", "pending")).take(MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL);
      if (theirs.length >= MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL) throw createError("VALIDATION_ERROR", "This person has too many invitations waiting. Ask them to answer some first.");
    }
    const values = { kind, item: shared.id, email, role, invitedBy: userId, expiresAt: Date.now() + WEEK, state: "pending" as const, delivery: "queued" as const };
    const invitationId = existing?._id ?? (await ctx.db.insert("itemInvitations", values));
    if (existing) await ctx.db.replace("itemInvitations", existing._id, values);
    await ctx.scheduler.runAt(values.expiresAt, internal.sharing.invitations.expire, { invitationId });
    if (!waits) await noteShared(ctx, shared, actor, email);
    return invitationId;
  },
});

/**
 * Marks an invitation expired once its time is up, so lists filter on its state and never
 * on the clock. One sent again has a later time and waits for its own run.
 */
export const expire = internalMutation({
  args: { invitationId: v.id("itemInvitations") },
  returns: v.null(),
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get("itemInvitations", invitationId);
    if (invitation?.state === "pending" && invitation.expiresAt <= Date.now()) await ctx.db.patch("itemInvitations", invitationId, { state: "expired" });
    return null;
  },
});

/** What an invitation's email says, or null once it no longer waits or its item is gone. */
export const readDelivery = internalQuery({
  args: { invitationId: v.id("itemInvitations") },
  returns: v.union(v.null(), v.object({ email: v.string(), kind: v.string(), name: v.string(), role: guestRoleValidator, inviter: v.string(), workspace: v.string() })),
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get("itemInvitations", invitationId);
    if (!invitation || invitation.state !== "pending" || invitation.expiresAt <= Date.now()) return null;
    const shared = await findShared(ctx, invitation.kind, invitation.item);
    const inviter = await ctx.db.get("users", invitation.invitedBy);
    if (!shared || !inviter) return null;
    return { email: invitation.email, kind: kindWord(shared.kind), name: shared.name, role: invitation.role, inviter: personName(inviter) || inviter.email, workspace: await workspaceName(ctx, shared.workspaceId) };
  },
});

export const recordDelivery = internalMutation({
  args: { invitationId: v.id("itemInvitations"), delivery: v.union(v.literal("sent"), v.literal("failed")) },
  returns: v.null(),
  handler: async (ctx, { invitationId, delivery }) => {
    const invitation = await ctx.db.get("itemInvitations", invitationId);
    if (invitation?.state === "pending") await ctx.db.patch("itemInvitations", invitationId, { delivery });
    return null;
  },
});

/** Answers an invitation for `userId`, whose verified addresses Clerk gave as `emails`. */
export const respondVerified = internalMutation({
  args: { userId: v.id("users"), invitationId: v.id("itemInvitations"), emails: v.array(v.string()), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { userId, invitationId, emails, accept }) => {
    const [invitation, person] = await Promise.all([ctx.db.get("itemInvitations", invitationId), ctx.db.get("users", userId)]);
    if (!invitation || person?.state !== "active" || !emails.includes(invitation.email)) throw createError("FORBIDDEN", "Sign in with the invited email address");
    if (invitation.state !== "pending" || invitation.expiresAt <= Date.now()) throw createError("CONFLICT", "Invitation expired or already answered");
    const shared = await findShared(ctx, invitation.kind, invitation.item);
    if (!shared) throw createError("NOT_FOUND", "What you were invited to is no longer there.");
    // Its place becomes theirs. Someone who joined its workspace since has it without one.
    if (accept && !(await actorIn(ctx, person, shared.workspaceId)) && !(await grantOf(ctx, shared.id, userId))) {
      await ctx.db.insert("itemAccess", { kind: shared.kind, item: shared.id, name: shared.name, userId, role: invitation.role, grantedBy: invitation.invitedBy, grantedAt: Date.now() });
    }
    await ctx.db.patch("itemInvitations", invitationId, { state: accept ? "accepted" : "declined" });
    return null;
  },
});

/** Who is answering, for Clerk to say which addresses are theirs. */
export const responder = internalQuery({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, { userId }) => {
    const person = await ctx.db.get("users", userId);
    if (!person) throw createError("UNAUTHENTICATED", "Authentication required");
    return person.clerkId;
  },
});

export const inviteAction = defineChangingAction({
  path: "sharing/invitations:invite",
  description:
    "Invites someone by email to one of the workspace's items, to view it (`viewer`), or to change what's in it and run jobs on it too (`editor`). Any member of the item's workspace can. " +
    "They get an email with a link, good for seven days, and accept it signed in with that address; the item then shows under their Shared with me, and what they run on it uses their own credits. " +
    "The invitation takes one of the guest places the workspace's plan allows on each item until it's answered. Inviting the same address again sends the email again.",
  args: invitationArgs,
  returns: v.null(),
  spendsCredits: false,
  // An email goes out, and someone outside the workspace can take up access to the item.
  outsideEffect: true,
  undoable: false,
  run: async (ctx, { userId, workspaceId, author }, args) => {
    const invitationId: Id<"itemInvitations"> = await ctx.runMutation(internal.sharing.invitations.prepare, { userId, workspaceId, author, ...args });
    await ctx.runAction(internal.sharing.mail.deliver, { invitationId });
    return null;
  },
});
export const invite = userAction(inviteAction);
export const inviteForAssistant = assistantAction(inviteAction);

export const respondAction = defineChangingAction({
  path: "sharing/invitations:respond",
  description: "Accepts or declines an invitation the person was sent to an item. Their account must have the invited address verified. Accepted, the item shows under their Shared with me.",
  args: { invitationId: v.id("itemInvitations"), accept: v.boolean() },
  returns: v.null(),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, { userId }, args) => {
    const clerkUserId: string = await ctx.runQuery(internal.sharing.invitations.responder, { userId });
    const emails: string[] = await ctx.runAction(internal.sharing.mail.verifiedEmails, { clerkUserId });
    await ctx.runMutation(internal.sharing.invitations.respondVerified, { userId, ...args, emails });
    return null;
  },
});
export const respond = userAction(respondAction);
export const respondForAssistant = assistantAction(respondAction);
