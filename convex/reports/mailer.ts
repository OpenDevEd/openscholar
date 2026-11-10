"use node";

// Sends one email about a report through the platform's mail service (./mail.ts says when; lib/reports/emails.ts
// says what). Every email is kept on its report's record, sent or not, so a reviewer sees what the team and the
// author were told.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { optionalPlatformMailService } from "../evidenceLibraries/runtimeActionConfig";
import { requireAppUrl } from "../lib/env";
import { sendInvitationEmail } from "../lib/invitationDelivery";
import { reportEmail } from "../../lib/reports/emails";
import { mailEventValidator } from "./mail";

export const send = internalAction({
  args: { reportId: v.id("reports"), event: mailEventValidator, edited: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { reportId, event, edited }) => {
    const report = await ctx.runQuery(internal.reports.mail.facts, { reportId });
    const email = report && reportEmail(event, { ...report, ...(edited && { edited }) }, requireAppUrl());
    // The report is gone, or its author has no address to write to.
    if (!email) return null;
    let error: string | undefined;
    try {
      const mail = optionalPlatformMailService((message) => new Error(message));
      if (mail) await sendInvitationEmail(mail, { senderName: "Openscholar Reports", to: email.to, replyTo: email.replyTo, subject: email.subject, text: email.text, html: email.html });
      else error = "Mail isn't set up on this deployment.";
    } catch (failure) {
      error = String(failure).slice(0, 300);
      console.error(JSON.stringify({ event: "report-email-failed", reportId, email: event, error }));
    }
    await ctx.runMutation(internal.reports.mail.sent, { reportId, event: email.label, audience: email.audience, subject: email.subject, text: email.text, ...(error && { error }) });
    return null;
  },
});
