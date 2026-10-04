import { v } from "convex/values";
import { query, mutation } from "../lib/functions";
import { MAX_PENDING_INVITATIONS_PER_PROFILE, MAX_PROFILE_MEMBERS } from "../lib/queryBounds";
import { requireProfileAccess } from "./access";
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
    const owner = await ctx.db.get("users", profile.ownerId);
    // Accepting an invitation and sending one keep both within these (./invitations.ts).
    const members = await ctx.db.query("authorProfileMembers").withIndex("by_profileId_and_userId", q => q.eq("profileId", profileId)).take(MAX_PROFILE_MEMBERS);
    const invitations = role === "owner" ? await ctx.db.query("authorProfileInvitations").withIndex("by_profileId_and_state", q => q.eq("profileId", profileId).eq("state", "pending")).take(MAX_PENDING_INVITATIONS_PER_PROFILE) : [];
    const users = await Promise.all(members.map(member => ctx.db.get("users", member.userId)));
    return {
      role,
      members: [owner, ...users].filter(user => user?.state === "active").map(user => ({
        userId: user!._id, name: [user!.firstName, user!.lastName].filter(Boolean).join(" ") || user!.email,
        email: user!.email, imageUrl: user!.avatarUrl, role: user!._id === profile.ownerId ? "owner" as const : "editor" as const,
      })),
      invitations,
    };
  },
});

export const remove = mutation({
  args: {profileId: v.id("authorProfiles"), userId: v.id("users")},
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId, true);
    const member = await ctx.db.query("authorProfileMembers")
      .withIndex("by_profileId_and_userId", q => q.eq("profileId", args.profileId).eq("userId", args.userId)).unique();
    if (member) await ctx.db.delete("authorProfileMembers", member._id);
    return null;
  },
});
