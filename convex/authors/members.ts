import { v } from "convex/values";
import { query, type QueryCtx } from "../lib/functions";
import type { Id } from "../_generated/dataModel";
import { MAX_PROFILE_MEMBERS } from "../lib/queryBounds";
import { profileOwners, requireProfileAccess } from "./access";
import { profileAccessValidator } from "./validators";

/**
 * Who has a profile, for its Access section: its owners through the workspace that owns it
 * (#650), then its editors, who are its guests (#653), and for an owner the invitations still
 * waiting. Editors are invited, and removed, as any item's guests are (../sharing).
 */
export async function readProfileMembers(ctx: QueryCtx, profileId: Id<"authorProfiles">) {
  const {profile, user: reader, role} = await requireProfileAccess(ctx, profileId);
  const owners = await profileOwners(ctx, profile);
  const ownerIds = new Set(owners.map(owner => owner._id));
  // A profile has at most MAX_PROFILE_MEMBERS guests, the invitations still waiting among them (../sharing/items.ts), so each list is whole.
  const guests = await ctx.db.query("itemAccess").withIndex("by_item_and_grantedAt", q => q.eq("item", profileId)).take(MAX_PROFILE_MEMBERS);
  const invitations = role === "owner" ? await ctx.db.query("itemInvitations").withIndex("by_item_and_state", q => q.eq("item", profileId).eq("state", "pending")).take(MAX_PROFILE_MEMBERS) : [];
  const editors = (await Promise.all(guests.map(guest => ctx.db.get("users", guest.userId)))).filter(user => user && !ownerIds.has(user._id));
  // An email is its owners', who manage its people: an editor reads names, photos and roles, as a community's team does.
  const owner = role === "owner";
  return {
    role,
    members: [...owners, ...editors].filter(user => user?.state === "active").map(user => {
      const name = [user!.firstName, user!.lastName].filter(Boolean).join(" ");
      return {
        userId: user!._id, name: owner ? name || user!.email : name,
        email: owner ? user!.email : "", imageUrl: user!.avatarUrl, role: ownerIds.has(user!._id) ? "owner" as const : "editor" as const, you: user!._id === reader._id,
      };
    }),
    invitations: invitations.map(({_id, email, delivery}) => ({_id, email, delivery})),
  };
}

export const list = query({
  args: {profileId: v.id("authorProfiles")},
  returns: profileAccessValidator,
  handler: async (ctx, {profileId}) => await readProfileMembers(ctx, profileId),
});
