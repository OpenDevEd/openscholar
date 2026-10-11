import { v } from "convex/values";
import { query } from "../lib/functions";
import { MAX_PENDING_INVITATIONS_PER_PROFILE, MAX_PROFILE_MEMBERS } from "../lib/queryBounds";
import { profileOwners, requireProfileAccess } from "./access";
import { profileInvitationsValidator, profileMembersValidator, profileRoleValidator } from "./validators";

/**
 * Who has a profile, for its Access section: its owners through the workspace that owns it
 * (#650), then its editors, who are its guests (#653), and for an owner the invitations still
 * waiting. Editors are invited, and removed, as any item's guests are (../sharing).
 */
export const list = query({
  args: {profileId: v.id("authorProfiles")},
  returns: v.object({
    role: profileRoleValidator,
    members: profileMembersValidator,
    invitations: profileInvitationsValidator,
  }),
  handler: async (ctx, {profileId}) => {
    const {profile, user: reader, role} = await requireProfileAccess(ctx, profileId);
    const owners = await profileOwners(ctx, profile);
    const ownerIds = new Set(owners.map(owner => owner._id));
    // The plan of the profile's workspace keeps its guests within what it allows; these read no more than a list holds.
    const guests = await ctx.db.query("itemAccess").withIndex("by_item_and_grantedAt", q => q.eq("item", profileId)).take(MAX_PROFILE_MEMBERS);
    const invitations = role === "owner" ? await ctx.db.query("itemInvitations").withIndex("by_item_and_state", q => q.eq("item", profileId).eq("state", "pending")).take(MAX_PENDING_INVITATIONS_PER_PROFILE) : [];
    const editors = (await Promise.all(guests.map(guest => ctx.db.get("users", guest.userId)))).filter(user => user && !ownerIds.has(user._id));
    return {
      role,
      members: [...owners, ...editors].filter(user => user?.state === "active").map(user => ({
        userId: user!._id, name: [user!.firstName, user!.lastName].filter(Boolean).join(" ") || user!.email,
        email: user!.email, imageUrl: user!.avatarUrl, role: ownerIds.has(user!._id) ? "owner" as const : "editor" as const, you: user!._id === reader._id,
      })),
      invitations: invitations.map(({_id, email, delivery}) => ({_id, email, delivery})),
    };
  },
});
