"use node";

import { renderLibraryInvitation } from "../../lib/emails/library-template";
import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireInvitationMail, sendInvitationEmail, verifiedInvitationEmails } from "../lib/invitationDelivery";
import { requireAppUrl } from "../lib/env";
import { createError } from "../lib/errors";

export const invite = action({
  args: { libraryId: v.id("evidenceLibraries"), email: v.string(), role: v.union(v.literal("editor"), v.literal("creator")) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const mail = requireInvitationMail();
    const origin = requireAppUrl();
    const invitationsUrl = new URL("/evidence-libraries?view=invitations", origin).href;
    const invitationId = await ctx.runMutation(internal.evidenceLibraries.invitations.prepare, args);
    const invitation = await ctx.runQuery(internal.evidenceLibraries.invitations.readDelivery, { invitationId });
    if (!invitation) throw createError("CONFLICT", "Invitation is no longer available");
    try {
      await sendInvitationEmail(mail, {
        senderName: invitation.libraryName,
        senderEmail: invitation.contactEmail,
        to: invitation.email,
        subject: `Invitation to ${invitation.libraryName}`,
        html: renderLibraryInvitation({
          identity: {...invitation.emailIdentity, baseUrl: invitation.emailIdentity.baseUrl ?? origin},
          role: invitation.role, invitationsUrl,
        }),
        text: `You have been invited to ${invitation.libraryName} with the ${invitation.role} role.\n\nSign in with ${invitation.email} to view and accept the invitation:\n${invitationsUrl}\n\nThis invitation expires in seven days. It grants access to this library only.`,
      });
    } catch (error) {
      console.error("Library invitation email failed", { invitationId, error });
      await ctx.runMutation(internal.evidenceLibraries.invitations.recordDelivery, { invitationId, delivery: "failed" });
      throw createError("VALIDATION_ERROR", "The invitation email could not be sent. Try again.");
    }
    await ctx.runMutation(internal.evidenceLibraries.invitations.recordDelivery, { invitationId, delivery: "sent" });
    return null;
  },
});

export const respond = action({
  args: { invitationId: v.id("evidenceLibraryInvitations"), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const emails = await verifiedInvitationEmails(ctx);
    return await ctx.runMutation(internal.evidenceLibraries.invitations.respondVerified, { ...args, emails });
  },
});
