import { v } from "convex/values";
import { query, mutation } from "../_generated/server";
import { requireProfileAccess } from "./access";

export const list = query({
  args: {profileId: v.id("authorProfiles")},
  handler: async (ctx, {profileId}) => {
    const {profile, role} = await requireProfileAccess(ctx, profileId);
    const owner = await ctx.db.get("users", profile.ownerId);
    const members = await ctx.db.query("authorProfileMembers").withIndex("by_profileId_and_userId", q => q.eq("profileId", profileId)).take(100);
    const invitations = role === "owner" ? await ctx.db.query("authorProfileInvitations").withIndex("by_profileId_and_email", q => q.eq("profileId", profileId)).take(100) : [];
    const users = await Promise.all(members.map(member => ctx.db.get("users", member.userId)));
    return {
      role,
      members: [owner, ...users].filter(user => user?.state === "active").map(user => ({
        userId: user!._id, name: [user!.firstName, user!.lastName].filter(Boolean).join(" ") || user!.email,
        email: user!.email, imageUrl: user!.avatarUrl, role: user!._id === profile.ownerId ? "owner" as const : "editor" as const,
      })),
      invitations: invitations.filter(i => i.state === "pending" && i.expiresAt > Date.now()),
    };
  },
});

export const remove = mutation({
  args: {profileId: v.id("authorProfiles"), userId: v.id("users")},
  handler: async (ctx, args) => {
    await requireProfileAccess(ctx, args.profileId, true);
    const member = await ctx.db.query("authorProfileMembers")
      .withIndex("by_profileId_and_userId", q => q.eq("profileId", args.profileId).eq("userId", args.userId)).unique();
    if (member) await ctx.db.delete("authorProfileMembers", member._id);
  },
});
