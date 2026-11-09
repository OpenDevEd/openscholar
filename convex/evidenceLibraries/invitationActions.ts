"use node";

import { renderLibraryInvitation } from "../../lib/emails/library-template";
import { renderOrganizationInvitation } from "../../lib/emails/organization-invitation";
import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { requireInvitationMail, sendInvitationEmail, verifiedEmailsOf, verifiedInvitationEmails } from "../lib/invitationDelivery";
import { requireAppUrl } from "../lib/env";
import { createError } from "../lib/errors";

// `toOrganization`: for an organization the invited person is an admin of (#1091).
const inviteArgs = { libraryId: v.id("evidenceLibraries"), email: v.string(), role: v.union(v.literal("editor"), v.literal("creator")), toOrganization: v.optional(v.boolean()) };

/** Keeps an invitation and emails it, as the caller or, with `actingAs`, the person the assistant acts for. */
async function sendInvitation(ctx: ActionCtx, args: { libraryId: Id<"evidenceLibraries">; email: string; role: "editor" | "creator"; toOrganization?: boolean; actingAs?: Id<"users"> }): Promise<null> {
  const mail = requireInvitationMail();
  const origin = requireAppUrl();
  const invitationsUrl = new URL("/evidence-communities?from=shared", origin).href;
  const invitationId = await ctx.runMutation(internal.evidenceLibraries.invitations.prepare, args);
  const invitation = await ctx.runQuery(internal.evidenceLibraries.invitations.readDelivery, { invitationId, ...(args.actingAs ? { actingAs: args.actingAs } : {}) });
  if (!invitation) throw createError("CONFLICT", "Invitation is no longer available");
  try {
    await sendInvitationEmail(mail, {
      senderName: invitation.libraryName,
      senderEmail: invitation.contactEmail,
      to: invitation.email,
      subject: `Invitation to ${invitation.libraryName}`,
      html: (invitation.toOrganization ? renderOrganizationInvitation : renderLibraryInvitation)({
        identity: {...invitation.emailIdentity, baseUrl: invitation.emailIdentity.baseUrl ?? origin},
        role: invitation.role, acceptUrl: invitationsUrl,
      }),
      text: invitation.toOrganization
        ? `Your organization has been invited to ${invitation.libraryName} with the ${invitation.role} role: everyone in it gets that role.\n\nSign in with ${invitation.email} to accept it for an organization you're an admin of:\n${invitationsUrl}\n\nThis invitation expires in seven days. It grants access to this community only.`
        : `You have been invited to ${invitation.libraryName} with the ${invitation.role} role.\n\nSign in with ${invitation.email} to view and accept the invitation:\n${invitationsUrl}\n\nThis invitation expires in seven days. It grants access to this community only.`,
    });
  } catch (error) {
    console.error("Community invitation email failed", { invitationId, error });
    await ctx.runMutation(internal.sharing.invitations.recordDelivery, { invitationId, delivery: "failed" });
    throw createError("VALIDATION_ERROR", "The invitation email could not be sent. Try again.");
  }
  await ctx.runMutation(internal.sharing.invitations.recordDelivery, { invitationId, delivery: "sent" });
  return null;
}

export const invite = action({
  args: inviteArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => await sendInvitation(ctx, args),
});

/** The same, for the person the assistant acts for (./assistant.ts). */
export const inviteFor = internalAction({
  args: { ...inviteArgs, actingAs: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => await sendInvitation(ctx, args),
});

// `organizationId`: on accepting one for an organization, which of the person's gets it (#1091).
const answerArgs = { invitationId: v.id("itemInvitations"), accept: v.boolean(), organizationId: v.optional(v.id("organizations")) };

export const respond = action({
  args: answerArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const emails = await verifiedInvitationEmails(ctx);
    return await ctx.runMutation(internal.evidenceLibraries.invitations.respondVerified, { ...args, emails });
  },
});

/** The same, for the person the assistant acts for (./assistant.ts): the addresses Clerk verified on their account. */
export const respondFor = internalAction({
  args: { ...answerArgs, actingAs: v.id("users") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const person = await ctx.runQuery(internal.users.internal.getUserById, { userId: args.actingAs });
    if (!person) throw createError("UNAUTHENTICATED", "Sign in to respond");
    return await ctx.runMutation(internal.evidenceLibraries.invitations.respondVerified, { ...args, emails: await verifiedEmailsOf(person.clerkId) });
  },
});
