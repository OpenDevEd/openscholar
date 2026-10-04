import { paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { internalMutation, internalQuery, mutation, query } from "../lib/functions";
import { requireAuth } from "../lib/auth";
import { createError } from "../lib/errors";
import { MAX_PENDING_PROFILE_INVITATIONS_PER_EMAIL } from "../lib/queryBounds";
import { rateLimit } from "../lib/rateLimit";
import { requireProfileAccess } from "./access";

export const prepare = internalMutation({
  args: {profileId: v.id("authorProfiles"), email: v.string()},
  handler: async (ctx, args) => {
    const {user} = await requireProfileAccess(ctx, args.profileId, true);
    await rateLimit(ctx, {name: "profile-invitation", key: String(user._id), throws: true});
    const email = args.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw createError("VALIDATION_ERROR", "Enter a valid email address");
    if (email === user.email.toLowerCase()) throw createError("CONFLICT", "You already own this profile");
    const pending = await ctx.db.query("authorProfileInvitations")
      .withIndex("by_profileId_and_email", q => q.eq("profileId", args.profileId).eq("email", email)).unique();
    // Sending one again changes nothing about how many wait; only a new one, or one answered or expired, counts.
    if (pending?.state !== "pending") {
      const theirs = await ctx.db.query("authorProfileInvitations")
        .withIndex("by_email_and_state", q => q.eq("email", email).eq("state", "pending")).take(MAX_PENDING_PROFILE_INVITATIONS_PER_EMAIL);
      if (theirs.length >= MAX_PENDING_PROFILE_INVITATIONS_PER_EMAIL) throw createError("VALIDATION_ERROR", "This person has too many invitations waiting. Ask them to answer some first.");
    }
    const values = {profileId: args.profileId, email, invitedBy: user._id, expiresAt: Date.now() + 7 * 86400000, state: "pending" as const, delivery: "queued" as const};
    const invitationId = pending?._id ?? await ctx.db.insert("authorProfileInvitations", values);
    if (pending) await ctx.db.replace("authorProfileInvitations", pending._id, values);
    await ctx.scheduler.runAt(values.expiresAt, internal.authors.invitations.expire, {invitationId});
    return invitationId;
  },
});

/**
 * Marks an invitation expired once its time is up, so lists filter on its state and
 * never on the clock. A re-sent invitation has a later time and waits for its own run.
 */
export const expire = internalMutation({
  args: {invitationId: v.id("authorProfileInvitations")},
  returns: v.null(),
  handler: async (ctx, {invitationId}) => {
    const invitation = await ctx.db.get("authorProfileInvitations", invitationId);
    if (invitation?.state === "pending" && invitation.expiresAt <= Date.now()) await ctx.db.patch("authorProfileInvitations", invitationId, {state: "expired"});
    return null;
  },
});

export const readDelivery = internalQuery({
  args: {invitationId: v.id("authorProfileInvitations")},
  handler: async (ctx, {invitationId}) => {
    const invitation = await ctx.db.get("authorProfileInvitations", invitationId);
    if (!invitation || invitation.state !== "pending" || invitation.expiresAt <= Date.now()) return null;
    const {profile} = await requireProfileAccess(ctx, invitation.profileId, true);
    return {email: invitation.email, profileName: profile.name};
  },
});

export const recordDelivery = internalMutation({
  args: {invitationId: v.id("authorProfileInvitations"), delivery: v.union(v.literal("sent"), v.literal("failed"))},
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get("authorProfileInvitations", args.invitationId);
    if (invitation?.state === "pending") await ctx.db.patch("authorProfileInvitations", args.invitationId, {delivery: args.delivery});
  },
});

export const cancel = mutation({
  args: {invitationId: v.id("authorProfileInvitations")},
  returns: v.null(),
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get("authorProfileInvitations", args.invitationId);
    if (!invitation) throw createError("NOT_FOUND", "Invitation not found");
    await requireProfileAccess(ctx, invitation.profileId, true);
    await ctx.db.patch("authorProfileInvitations", args.invitationId, {state: "cancelled"});
    return null;
  },
});

const waitingInvitationValidator = v.object({invitationId: v.id("authorProfileInvitations"), profileId: v.id("authorProfiles"), name: v.string()});
const waitingArgs = {profileId: v.optional(v.id("authorProfiles"))};

/** The profile invitations waiting for the person: the one to `profileId`, or all of them, which inviting keeps to MAX_PENDING_PROFILE_INVITATIONS_PER_EMAIL. */
async function waitingInvitations(ctx: QueryCtx, {profileId}: {profileId?: Id<"authorProfiles">}) {
  const user = await requireAuth(ctx);
  const email = user.email.toLowerCase();
  const invitation = profileId ? await ctx.db.query("authorProfileInvitations")
    .withIndex("by_profileId_and_email", q => q.eq("profileId", profileId).eq("email", email)).unique() : null;
  const invitations = profileId ? invitation ? [invitation] : [] : await ctx.db.query("authorProfileInvitations")
    .withIndex("by_email_and_state", q => q.eq("email", email).eq("state", "pending")).take(MAX_PENDING_PROFILE_INVITATIONS_PER_EMAIL);
  return (await Promise.all(invitations.filter(i => i.state === "pending").map(async invitation => {
    const profile = await ctx.db.get("authorProfiles", invitation.profileId);
    return profile ? {invitationId: invitation._id, profileId: profile._id, name: profile.name} : null;
  }))).filter(row => row !== null);
}

/** The profile invitations waiting for the person, as one page: an address has no more waiting than a page holds. */
export const listInvitations = query({
  args: waitingArgs,
  returns: paginationResultValidator(waitingInvitationValidator),
  handler: async (ctx, args) => ({page: await waitingInvitations(ctx, args), isDone: true, continueCursor: ""}),
});

/** Kept for one release, while the deployed site still calls it; `listInvitations` replaces it. */
export const listMine = query({
  args: waitingArgs,
  returns: v.array(waitingInvitationValidator),
  handler: waitingInvitations,
});

export const respondVerified = internalMutation({
  args: {invitationId: v.id("authorProfileInvitations"), emails: v.array(v.string()), accept: v.boolean()},
  handler: async (ctx, args) => {
    const user = await requireAuth(ctx);
    const invitation = await ctx.db.get("authorProfileInvitations", args.invitationId);
    if (!invitation || !args.emails.includes(invitation.email)) throw createError("FORBIDDEN", "Sign in with the invited email address");
    if (invitation.state !== "pending" || invitation.expiresAt <= Date.now()) throw createError("CONFLICT", "Invitation expired or already answered");
    const profile = await ctx.db.get("authorProfiles", invitation.profileId);
    if (!profile) throw createError("NOT_FOUND", "Author profile not found");
    if (args.accept && profile.ownerId !== user._id) {
      const member = await ctx.db.query("authorProfileMembers")
        .withIndex("by_profileId_and_userId", q => q.eq("profileId", profile._id).eq("userId", user._id)).unique();
      if (!member) await ctx.db.insert("authorProfileMembers", {profileId: profile._id, userId: user._id});
    }
    await ctx.db.patch("authorProfileInvitations", invitation._id, {state: args.accept ? "accepted" : "declined"});
  },
});
