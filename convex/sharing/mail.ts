"use node";
// The parts of an item invitation (#653) that need Node: sending its email, and asking Clerk
// which addresses an account has verified. ./invitations.ts runs them.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { requireAppUrl } from "../lib/env";
import { createError } from "../lib/errors";
import { requireInvitationMail, sendInvitationEmail, verifiedEmailsOf } from "../lib/invitationDelivery";
import { itemInvitationMessage } from "../../lib/emails/item-invitation";

/** Sends a waiting invitation's email and records whether it went. */
export const deliver = internalAction({
  args: { invitationId: v.id("itemInvitations") },
  returns: v.null(),
  handler: async (ctx, { invitationId }): Promise<null> => {
    const mail = requireInvitationMail();
    const invitation = await ctx.runQuery(internal.sharing.invitations.readDelivery, { invitationId });
    if (!invitation) throw createError("CONFLICT", "Invitation is no longer available");
    try {
      await sendInvitationEmail(mail, {
        senderName: `${invitation.inviter} via OpenScholar`,
        to: invitation.email,
        ...itemInvitationMessage({ origin: requireAppUrl(), invitationId, ...invitation }),
      });
    } catch (error) {
      console.error("Item invitation email failed", { invitationId, error });
      await ctx.runMutation(internal.sharing.invitations.recordDelivery, { invitationId, delivery: "failed" });
      throw createError("VALIDATION_ERROR", "The invitation email could not be sent. Try again.");
    }
    await ctx.runMutation(internal.sharing.invitations.recordDelivery, { invitationId, delivery: "sent" });
    return null;
  },
});

/** The addresses Clerk has verified on an account, in lower case. */
export const verifiedEmails = internalAction({
  args: { clerkUserId: v.string() },
  returns: v.array(v.string()),
  handler: (_ctx, { clerkUserId }) => verifiedEmailsOf(clerkUserId),
});
