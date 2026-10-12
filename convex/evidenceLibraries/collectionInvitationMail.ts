"use node";
// Sending an invitation to a reader's collection in an Evidence Library (./collectionInvitations.ts), in the library's name.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { requireInvitationMail, sendInvitationEmail } from "../lib/invitationDelivery";
import { renderCollectionInvitation } from "../../lib/emails/library-template";

/** Sends a waiting invitation's email, and keeps and answers whether it went. One that can't go is logged with why. */
export const deliver = internalAction({
  args: { invitationId: v.id("itemInvitations") },
  returns: v.union(v.literal("sent"), v.literal("failed")),
  handler: async (ctx, { invitationId }): Promise<"sent" | "failed"> => {
    const invitation = await ctx.runQuery(internal.evidenceLibraries.collectionInvitations.readDelivery, { invitationId });
    let delivery: "sent" | "failed" = "failed";
    if (!invitation) console.error("Collection invitation email has nothing to send", { invitationId });
    else {
      const role = invitation.role === "editor" ? "edit" : "view";
      try {
        await sendInvitationEmail(requireInvitationMail(), {
          senderName: `${invitation.inviter} via ${invitation.libraryName}`,
          senderEmail: invitation.contactEmail,
          to: invitation.email,
          subject: `${invitation.inviter} shared ${invitation.collectionName} with you`,
          html: renderCollectionInvitation({
            identity: { ...invitation.emailIdentity, baseUrl: invitation.emailIdentity.baseUrl ?? new URL(invitation.acceptUrl).origin },
            inviter: invitation.inviter, collectionName: invitation.collectionName, role: invitation.role, acceptUrl: invitation.acceptUrl,
          }),
          text: `${invitation.inviter} shared the collection ${invitation.collectionName} with you in ${invitation.libraryName}. You can ${role} it.\n\nSign in with ${invitation.email} to open the invitation:\n${invitation.acceptUrl}\n\nThis invitation expires in seven days.`,
        });
        delivery = "sent";
      } catch (error) {
        console.error("Collection invitation email failed", { invitationId, error });
      }
    }
    await ctx.runMutation(internal.sharing.invitations.recordDelivery, { invitationId, delivery });
    return delivery;
  },
});
