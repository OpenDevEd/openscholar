import { paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "../lib/functions";
import { requireAuth } from "../lib/auth";
import { MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL } from "../lib/queryBounds";

/**
 * The invitations to edit a profile that wait for the person, for the Authors page to offer
 * them: an invitation to a profile is an item's (#653, ../sharing/invitations.ts), which holds
 * an address to MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL waiting, so they are one page.
 */
export const listInvitations = query({
  args: {},
  returns: paginationResultValidator(v.object({invitationId: v.id("itemInvitations"), profileId: v.id("authorProfiles"), name: v.string()})),
  handler: async ctx => {
    const user = await requireAuth(ctx);
    const waiting = await ctx.db.query("itemInvitations").withIndex("by_email_and_state", q => q.eq("email", user.email.toLowerCase()).eq("state", "pending")).take(MAX_PENDING_ITEM_INVITATIONS_PER_EMAIL);
    const page = (await Promise.all(waiting.filter(invitation => invitation.kind === "author").map(async invitation => {
      const profileId = ctx.db.normalizeId("authorProfiles", invitation.item);
      const profile = profileId ? await ctx.db.get("authorProfiles", profileId) : null;
      return profile ? [{invitationId: invitation._id, profileId: profile._id, name: profile.name}] : [];
    }))).flat();
    return {page, isDone: true, continueCursor: ""};
  },
});
