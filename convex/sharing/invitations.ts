/**
 * Inviting someone to an item by email (#653), for anyone the sharer can't pick by name. The
 * invitation holds a guest's place on the item until it's answered, cancelled or seven days
 * old. Whoever accepts must have the invited address verified on their account, which Clerk
 * confirms (./mail.ts).
 */
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery } from "../lib/functions";
import { createError } from "../lib/errors";
import { personName } from "../lib/people";
import { MAX_ACCOUNTS_PER_EMAIL, MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL } from "../lib/queryBounds";
import { rateLimit } from "../lib/rateLimit";
import { actingAs, assistantAction, assistantQuery, defineChangingAction, defineUserQuery, userAction, userQuery } from "../lib/userActions";
import { workspaceFrom, workspaceName } from "../workspaces/personal";
import { holds, invitationTo, listedBy, noteShared, requireRoom } from "./access";
import { findShared, grantOf, kindWord, open, requireRole, sharedIn } from "./items";
import { guestRoleValidator, sharedFromValidator, sharedKindValidator, type SharedKind } from "./validators";

const WEEK = 7 * 86_400_000;
const actingValidator = { userId: v.id("users"), workspaceId: v.id("workspaces"), author: v.union(v.literal("user"), v.literal("assistant")) };
const invitationArgs = { kind: sharedKindValidator, id: v.string(), email: v.string(), role: guestRoleValidator };

/** Checks an invitation and keeps it, ready to send. Sending one again restarts its seven days and takes no second place. */
export const prepare = internalMutation({
  args: { ...actingValidator, ...invitationArgs },
  returns: v.id("itemInvitations"),
  handler: async (ctx, { userId, workspaceId, author, kind, id, role, ...args }) => {
    requireRole(kind, role);
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
      if ((await holds(ctx, shared, account)) || (await grantOf(ctx, shared.id, account._id))) throw createError("CONFLICT", "This person has it already.");
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
    const shared = await invitedTo(ctx, invitation);
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

/**
 * What an invitation is to, while it's there to take up: its item, in a workspace that's still
 * someone's. One whose owner's account was deleted is gone to whoever was invited, in the email, on
 * its page and on accepting, though its row waits a moment to be removed (./upkeep.ts `close`).
 */
async function invitedTo(ctx: Pick<QueryCtx, "db">, invitation: Pick<Doc<"itemInvitations">, "kind" | "item">) {
  const shared = await findShared(ctx, invitation.kind, invitation.item);
  return shared && (await open(ctx, shared.workspaceId)) ? shared : null;
}

const opened = v.object({ kind: sharedKindValidator, id: v.string() });

/** Answers an invitation for `userId`, whose verified addresses Clerk gave as `emails`. Accepted, it returns the item it was to. */
export const respondVerified = internalMutation({
  args: { userId: v.id("users"), invitationId: v.id("itemInvitations"), emails: v.array(v.string()), accept: v.boolean() },
  returns: v.union(opened, v.null()),
  handler: async (ctx, { userId, invitationId, emails, accept }) => {
    const [invitation, person] = await Promise.all([ctx.db.get("itemInvitations", invitationId), ctx.db.get("users", userId)]);
    if (!invitation || person?.state !== "active" || !emails.includes(invitation.email)) throw createError("FORBIDDEN", "Sign in with the invited email address");
    const shared = await invitedTo(ctx, invitation);
    // Accepting again what they already accepted, as a second tab does, opens it again: theirs by their place, or by having joined its workspace since.
    if (accept && shared && invitation.state === "accepted" && ((await grantOf(ctx, shared.id, userId)) || (await holds(ctx, shared, person)))) return { kind: shared.kind, id: shared.id };
    if (invitation.state !== "pending" || invitation.expiresAt <= Date.now()) throw createError("CONFLICT", "Invitation expired or already answered");
    if (!shared) throw createError("NOT_FOUND", "What you were invited to is no longer there.");
    // Its place becomes theirs. Someone who joined its workspace since has it without one.
    if (accept && !(await holds(ctx, shared, person)) && !(await grantOf(ctx, shared.id, userId))) {
      await ctx.db.insert("itemAccess", { kind: shared.kind, item: shared.id, name: shared.name, userId, role: invitation.role, grantedBy: invitation.invitedBy, grantedAt: Date.now(), ...listedBy(shared) });
    }
    await ctx.db.patch("itemInvitations", invitationId, { state: accept ? "accepted" : "declined" });
    return accept ? { kind: shared.kind, id: shared.id } : null;
  },
});

// By name: what the action below returns is this mutation's answer, and the generated API can't be read for it while this module is being typed.
const respondVerifiedRef = makeFunctionReference<"mutation", { userId: Id<"users">; invitationId: Id<"itemInvitations">; emails: string[]; accept: boolean }, { kind: SharedKind; id: string } | null>("sharing/invitations:respondVerified");

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
    "Invites someone by email to one of the workspace's items, to view it (`viewer`: open, read and export) or to edit it (`editor`: also put papers in a collection and take them out). Any member of the item's workspace can. " +
    "They get an email with a link, good for seven days, and accept it signed in with that address; the item then shows under their Shared with me, and what they run on it uses their own credits. " +
    "The invitation takes one of the guest places the workspace's plan allows on each item until it's answered. Inviting the same address again sends the email again.",
  args: invitationArgs,
  returns: v.null(),
  spendsCredits: false,
  // An email goes out, and someone outside the workspace can take up access to the item.
  outsideEffect: true,
  undoable: false,
  // Read before the person is asked: a role the kind doesn't take, and an item that isn't this workspace's to share, as one shared with them isn't.
  check: async (ctx, actor, { kind, id, role }) => {
    requireRole(kind, role);
    await sharedIn(ctx, actor, kind, id);
  },
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
  description: "Accepts or declines an invitation the person was sent to an item. Their account must have the invited address verified. Accepted, the item shows under their Shared with me, and its kind and ID are returned.",
  args: { invitationId: v.id("itemInvitations"), accept: v.boolean() },
  returns: v.union(opened, v.null()),
  spendsCredits: false,
  outsideEffect: false,
  undoable: false,
  run: async (ctx, { userId }, args) => {
    const clerkUserId: string = await ctx.runQuery(internal.sharing.invitations.responder, { userId });
    const emails: string[] = await ctx.runAction(internal.sharing.mail.verifiedEmails, { clerkUserId });
    return await ctx.runMutation(respondVerifiedRef, { userId, ...args, emails });
  },
});
export const respond = userAction(respondAction);
export const respondForAssistant = assistantAction(respondAction);

export const getAction = defineUserQuery({
  path: "sharing/invitations:get",
  description:
    "An invitation to an item by its ID, as its email links to it: the item's kind, ID and name, what the invitation lets them do, who sent it, the workspace the item is in and how much it holds. " +
    "`state` is `pending` while it can be answered, and `accepted` once the person took it up. An account whose own address isn't the one it was sent to is told only that (`state` is `other`): " +
    "it can still accept, if that address is verified on it too. Null when it's gone, expired, or answered by someone else.",
  args: { invitationId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ state: v.literal("other") }),
    v.object({ kind: sharedKindValidator, id: v.string(), name: v.string(), role: guestRoleValidator, by: v.object({ name: v.string(), imageUrl: v.optional(v.string()) }), from: sharedFromValidator, size: v.optional(v.number()), state: v.union(v.literal("pending"), v.literal("accepted")) }),
  ),
  run: async (ctx, { userId }, { invitationId }) => {
    const id = ctx.db.normalizeId("itemInvitations", invitationId);
    const invitation = id ? await ctx.db.get("itemInvitations", id) : null;
    const shared = invitation ? await invitedTo(ctx, invitation) : null;
    if (!invitation || !shared) return null;
    // One that was accepted shows only to whoever holds the place it gave.
    const state = invitation.state === "pending" ? ("pending" as const) : invitation.state === "accepted" && (await grantOf(ctx, shared.id, userId)) ? ("accepted" as const) : null;
    if (!state) return null;
    // The link alone says nothing of the item: it may have been passed on. The address it was sent to does.
    if (state === "pending" && (await ctx.db.get("users", userId))?.email.toLowerCase() !== invitation.email) return { state: "other" as const };
    const inviter = await ctx.db.get("users", invitation.invitedBy);
    return {
      kind: shared.kind, id: shared.id, name: shared.name, role: invitation.role,
      by: { name: inviter ? personName(inviter) || inviter.email : "", ...(inviter?.avatarUrl ? { imageUrl: inviter.avatarUrl } : {}) },
      from: await workspaceFrom(ctx, shared.workspaceId), ...(shared.size === undefined ? {} : { size: shared.size }), state,
    };
  },
});
export const get = userQuery(getAction);
export const getForAssistant = assistantQuery(getAction);
