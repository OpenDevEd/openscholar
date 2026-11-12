"use node";

// Sends one email about a report through the platform's mail service (./mail.ts says when and about what;
// lib/reports/emails.ts says how it reads). Every email is kept on its report's record, sent or not, so a reviewer
// sees what the team and the author were told.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { optionalPlatformMailService, optionalRuntimeEnvironment } from "../evidenceLibraries/runtimeActionConfig";
import { requireAppUrl } from "../lib/env";
import { sendInvitationEmail } from "../lib/invitationDelivery";
import { mailAbout, reportEmail } from "../../lib/reports/emails";
import { mailArgs } from "./mail";

export const send = internalAction({
  args: mailArgs,
  returns: v.null(),
  handler: async (ctx, { reportId, event, report }) => {
    const about = mailAbout(event);
    // What is kept if the email can't even be written, as when the site's address isn't set: that it was owed.
    let kept = { audience: about.to, subject: `${about.label}: ${report.title}`, text: "" };
    let error: string | undefined;
    try {
      const email = reportEmail(event, report, requireAppUrl());
      // Its author has no address to write to.
      if (!email) return null;
      kept = { audience: email.audience, subject: email.subject, text: email.text };
      // Shared dev sets REPORT_EMAILS=off: its test reports would fill the team's inbox. The email is still kept below.
      const off = optionalRuntimeEnvironment("REPORT_EMAILS") === "off";
      const mail = off ? undefined : optionalPlatformMailService((message) => new Error(message));
      if (mail) for (const to of email.to) await sendInvitationEmail(mail, { senderName: "Openscholar Reports", to, replyTo: email.replyTo, subject: email.subject, text: email.text, html: email.html });
      else error = off ? "Report emails are off on this deployment." : "Mail isn't set up on this deployment.";
    } catch (failure) {
      error = String(failure).slice(0, 300);
      console.error(JSON.stringify({ event: "report-email-failed", reportId, email: event, error }));
    }
    await ctx.runMutation(internal.reports.mail.sent, { reportId, event: about.label, ...kept, ...(error && { error }) });
    return null;
  },
});
