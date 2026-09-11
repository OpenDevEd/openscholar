"use node";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAppUrl } from "../lib/env";
import { createError } from "../lib/errors";
import { requireInvitationMail, sendInvitationEmail, verifiedInvitationEmails } from "../lib/invitationDelivery";
import { authorInvitationMessage } from "../../lib/emails/author-invitation";

export const invite = action({
  args: {profileId: v.id("authorProfiles"), email: v.string()},
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const mail = requireInvitationMail();
    const invitationId = await ctx.runMutation(internal.authors.invitations.prepare, args);
    const invitation = await ctx.runQuery(internal.authors.invitations.readDelivery, {invitationId});
    if (!invitation) throw createError("CONFLICT", "Invitation is no longer available");
    try {
      await sendInvitationEmail(mail, {
        senderName: `${invitation.profileName} via OpenScholar`,
        to: invitation.email,
        ...authorInvitationMessage({ origin: requireAppUrl(), profileId: args.profileId, profileName: invitation.profileName, email: invitation.email }),
      });
    } catch (error) {
      console.error("Author profile invitation email failed", {invitationId, error});
      await ctx.runMutation(internal.authors.invitations.recordDelivery, {invitationId, delivery: "failed"});
      throw createError("VALIDATION_ERROR", "The invitation email could not be sent. Try again.");
    }
    await ctx.runMutation(internal.authors.invitations.recordDelivery, {invitationId, delivery: "sent"});
    return null;
  },
});

export const respond = action({
  args: {invitationId: v.id("authorProfileInvitations"), accept: v.boolean()},
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const emails = await verifiedInvitationEmails(ctx);
    await ctx.runMutation(internal.authors.invitations.respondVerified, {...args, emails});
    return null;
  },
});
