"use node";

import { v } from "convex/values";
import { action, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requireInvitationMail, sendInvitationEmail } from "../lib/invitationDelivery";
import { requireAppUrl } from "../lib/env";
import { createError } from "../lib/errors";

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Invites an email as an admin and sends the invitation. They're an admin from their first sign-in. */
export const invite = action({
  args: { email: v.string() },
  returns: v.id("admins"),
  handler: async (ctx, { email }): Promise<Id<"admins">> => {
    const adminId: Id<"admins"> = await ctx.runMutation(internal.admins.mutations.prepareInvite, { email });
    await deliver(ctx, adminId);
    return adminId;
  },
});

export const resend = action({
  args: { adminId: v.id("admins") },
  returns: v.null(),
  handler: async (ctx, { adminId }) => {
    await ctx.runMutation(internal.admins.mutations.prepareResend, { adminId });
    await deliver(ctx, adminId);
    return null;
  },
});

async function deliver(ctx: ActionCtx, adminId: Id<"admins">) {
  const row = await ctx.runQuery(internal.admins.mutations.readInvite, { adminId });
  if (!row) return;
  try {
    const mail = requireInvitationMail();
    const url = new URL("/settings/admin", requireAppUrl()).href;
    await sendInvitationEmail(mail, {
      senderName: "OpenScholar",
      to: row.email,
      subject: "You're an OpenScholar admin",
      text: `You've been made an OpenScholar admin.\n\nSign in with ${row.email} to change OpenScholar's settings:\n${url}`,
      html: `<p>You've been made an OpenScholar admin.</p><p>Sign in with ${escape(row.email)} to change OpenScholar's settings:</p><p><a href="${escape(url)}">${escape(url)}</a></p>`,
    });
  } catch (error) {
    console.error("[admins] invite email failed", { adminId, error });
    await ctx.runMutation(internal.admins.mutations.recordDelivery, { adminId, delivery: "failed" });
    throw createError("VALIDATION_ERROR", "The invite email could not be sent. Try again.");
  }
  await ctx.runMutation(internal.admins.mutations.recordDelivery, { adminId, delivery: "sent" });
}
