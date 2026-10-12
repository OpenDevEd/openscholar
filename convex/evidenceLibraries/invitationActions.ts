"use node";

import { renderLibraryInvitation } from "../../lib/emails/library-template";
import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { requireInvitationMail, sendInvitationEmail, verifiedEmailsOf, verifiedInvitationEmails } from "../lib/invitationDelivery";
import { requireAppUrl } from "../lib/env";
import { createError } from "../lib/errors";

const inviteArgs = { libraryId: v.id("evidenceLibraries"), email: v.string(), role: v.union(v.literal("editor"), v.literal("creator")) };

/** Keeps an invitation and emails it, as the caller or, with `actingAs`, the person the assistant acts for. */
async function sendInvitation(ctx: ActionCtx, args: { libraryId: Id<"evidenceLibraries">; email: string; role: "editor" | "creator"; actingAs?: Id<"users"> }): Promise<null> {
  const mail = requireInvitationMail();
  const origin = requireAppUrl();
  const invitationsUrl = new URL("/evidence-libraries?view=invitations", origin).href;
  const invitationId = await ctx.runMutation(internal.evidenceLibraries.invitations.prepare, args);
  const invitation = await ctx.runQuery(internal.evidenceLibraries.invitations.readDelivery, { invitationId, ...(args.actingAs ? { actingAs: args.actingAs } : {}) });
  if (!invitation) throw createError("CONFLICT", "Invitation is no longer available");
  try {
    await sendInvitationEmail(mail, {
      senderName: invitation.libraryName,
      senderEmail: invitation.contactEmail,
      to: invitation.email,
      subject: `Invitation to ${invitation.libraryName}`,
      html: renderLibraryInvitation({
        identity: {...invitation.emailIdentity, baseUrl: invitation.emailIdentity.baseUrl ?? origin},
        role: invitation.role, acceptUrl: invitationsUrl,
      }),
      text: `You have been invited to ${invitation.libraryName} with the ${invitation.role} role.\n\nSign in with ${invitation.email} to view and accept the invitation:\n${invitationsUrl}\n\nThis invitation expires in seven days. It grants access to this library only.`,
    });
  } catch (error) {
    console.error("Library invitation email failed", { invitationId, error });
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

const answerArgs = { invitationId: v.id("itemInvitations"), accept: v.boolean() };

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
