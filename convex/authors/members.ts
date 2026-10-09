import { v } from "convex/values";
import { query, mutation } from "../lib/functions";
import { MAX_PENDING_INVITATIONS_PER_PROFILE, MAX_PROFILE_MEMBERS } from "../lib/queryBounds";
import { createError } from "../lib/errors";
import { profileOwners, profileRoleForUser, requireProfileAccess } from "./access";
import { profileInvitationsValidator, profileMembersValidator, profileRoleValidator } from "./validators";

export const list = query({
  args: {profileId: v.id("authorProfiles")},
  returns: v.object({
    role: profileRoleValidator,
    members: profileMembersValidator,
    invitations: profileInvitationsValidator,
  }),
  handler: async (ctx, {profileId}) => {
    const {profile, role} = await requireProfileAccess(ctx, profileId);
    // Its owners through the workspace that owns it (#650), then the people invited to edit it.
    const owners = await profileOwners(ctx, profile);
    const ownerIds = new Set(owners.map(owner => owner._id));
    // Accepting an invitation and sending one keep both within these (./invitations.ts).
    const members = await ctx.db.query("authorProfileMembers").withIndex("by_profileId_and_userId", q => q.eq("profileId", profileId)).take(MAX_PROFILE_MEMBERS);
    const invitations = role === "owner" ? await ctx.db.query("authorProfileInvitations").withIndex("by_profileId_and_state", q => q.eq("profileId", profileId).eq("state", "pending")).take(MAX_PENDING_INVITATIONS_PER_PROFILE) : [];
    const editors = (await Promise.all(members.map(member => ctx.db.get("users", member.userId)))).filter(user => user && !ownerIds.has(user._id));
    return {
      role,
      members: [...owners, ...editors].filter(user => user?.state === "active").map(user => ({
        userId: user!._id, name: [user!.firstName, user!.lastName].filter(Boolean).join(" ") || user!.email,
        email: user!.email, imageUrl: user!.avatarUrl, role: ownerIds.has(user!._id) ? "owner" as const : "editor" as const,
      })),
      invitations,
    };
  },
});

export const remove = mutation({
  args: {profileId: v.id("authorProfiles"), userId: v.id("users")},
  returns: v.null(),
  handler: async (ctx, args) => {
    const {profile} = await requireProfileAccess(ctx, args.profileId, true);
    // An owner owns it through its workspace, and isn't removed from it here.
    if ((await profileRoleForUser(ctx, profile, args.userId)) === "owner") throw createError("CONFLICT", "This person owns the profile through its workspace, so they can't be removed from it.");
    const member = await ctx.db.query("authorProfileMembers")
      .withIndex("by_profileId_and_userId", q => q.eq("profileId", args.profileId).eq("userId", args.userId)).unique();
    if (member) await ctx.db.delete("authorProfileMembers", member._id);
    return null;
  },
});
