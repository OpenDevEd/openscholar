"use node";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAppUrl } from "../lib/env";
import { createError } from "../lib/errors";
import { requireInvitationMail, sendInvitationEmail, verifiedInvitationEmails } from "../lib/invitationDelivery";

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
        to: invitation.email, subject: `Invitation to edit ${invitation.profileName}`,
        text: `You have been invited to edit the author profile for ${invitation.profileName}.\n\nSign in with ${invitation.email} to accept:\n${new URL("/authors", requireAppUrl())}\n\nThis invitation expires in seven days. It grants access to this profile only.`,
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
