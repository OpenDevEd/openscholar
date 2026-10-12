"use node";
// Sending an invitation to a reader's collection in an Evidence Library (./collectionInvitations.ts), in the library's name.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { requireInvitationMail, sendInvitationEmail } from "../lib/invitationDelivery";
import { collectionInvitationMessage } from "../../lib/emails/collection-invitation";

/** Sends a waiting invitation's email for one send (`attempt`, its expiry), and keeps and answers whether it went. One that can't go is logged with why. */
export const deliver = internalAction({
  args: { invitationId: v.id("itemInvitations"), attempt: v.number() },
  returns: v.union(v.literal("sent"), v.literal("failed")),
  handler: async (ctx, { invitationId, attempt }): Promise<"sent" | "failed"> => {
    const invitation = await ctx.runQuery(internal.evidenceLibraries.collectionInvitations.readDelivery, { invitationId });
    let delivery: "sent" | "failed" = "failed";
    if (!invitation) console.error("Collection invitation email has nothing to send", { invitationId });
    else {
      try {
        await sendInvitationEmail(requireInvitationMail(), {
          senderName: `${invitation.inviter} via ${invitation.libraryName}`,
          senderEmail: invitation.contactEmail,
          to: invitation.email,
          ...collectionInvitationMessage({
            identity: { ...invitation.emailIdentity, baseUrl: invitation.emailIdentity.baseUrl ?? new URL(invitation.acceptUrl).origin },
            acceptUrl: invitation.acceptUrl, email: invitation.email, collectionName: invitation.collectionName, role: invitation.role, inviter: invitation.inviter,
          }),
        });
        delivery = "sent";
      } catch (error) {
        console.error("Collection invitation email failed", { invitationId, error });
      }
    }
    await ctx.runMutation(internal.evidenceLibraries.collectionInvitations.recordDelivery, { invitationId, attempt, delivery });
    return delivery;
  },
});
