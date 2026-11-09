"use node";

// The emails about applications to join a community (OS-31), sent after the change that calls for them.
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { requireAppUrl } from "../lib/env";
import { requireInvitationMail, sendInvitationEmail } from "../lib/invitationDelivery";
import { renderApplicationAnswer, renderApplicationReceived } from "../../lib/emails/library-application";

async function read(ctx: ActionCtx, applicationId: Id<"libraryApplications">) {
  return await ctx.runQuery(internal.evidenceLibraries.applications.readForEmail, { applicationId });
}

/** The ready-made decline reasons as the emails word them. */
const PRESETS = { topic: "Outside our topic", moreAbout: "Tell us more about your work", notNow: "Not adding people right now" } as const;

/** Owners and editors one run emails; the next run takes the next ones. */
const REVIEWERS_PER_RUN = 20;

/** Tells the community's owners and editors someone applied, with their message; replies go to the applicant. */
export const toReviewers = internalAction({
  args: { applicationId: v.id("libraryApplications"), from: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { applicationId, from = 0 }) => {
    const found = await read(ctx, applicationId);
    // Withdrawn or answered before the email went: nothing to tell.
    if (!found || found.state !== "waiting") return null;
    const mail = requireInvitationMail();
    const origin = requireAppUrl();
    const reviewUrl = new URL(`/evidence-communities/${found.libraryId}/configuration?section=team&team=applications`, origin).href;
    const identity = { ...found.emailIdentity, baseUrl: found.emailIdentity.baseUrl ?? origin };
    const these = found.reviewers.slice(from, from + REVIEWERS_PER_RUN);
    if (found.reviewers.length > from + REVIEWERS_PER_RUN) {
      await ctx.scheduler.runAfter(0, internal.evidenceLibraries.applicationEmails.toReviewers, { applicationId, from: from + REVIEWERS_PER_RUN });
    }
    for (const to of these) {
      try {
        await sendInvitationEmail(mail, {
          senderName: found.libraryName,
          senderEmail: found.contactEmail,
          replyTo: found.applicant.email,
          to,
          subject: `${found.applicant.name} wants to join ${found.libraryName}`,
          html: renderApplicationReceived({ identity, applicant: found.applicant, message: found.message, reviewUrl }),
          text: `${found.applicant.name} (${found.applicant.email}) applied to join ${found.libraryName} as a Creator:\n\n${found.message}\n\nReview applications: ${reviewUrl}`,
        });
      } catch (error) {
        // One address that fails doesn't keep the others from hearing.
        console.error("Community application email to a reviewer failed", { applicationId, error });
      }
    }
    return null;
  },
});

/** Tells the applicant the answer, with the reason for a no. */
export const toApplicant = internalAction({
  args: { applicationId: v.id("libraryApplications") },
  returns: v.null(),
  handler: async (ctx, { applicationId }) => {
    const found = await read(ctx, applicationId);
    if (!found || found.state === "waiting") return null;
    const mail = requireInvitationMail();
    const origin = requireAppUrl();
    const url = new URL("/evidence-communities", origin).href;
    const accepted = found.state === "accepted";
    const reason = [found.reasonPreset ? PRESETS[found.reasonPreset] : "", found.reason ?? ""].filter(Boolean).join("\n") || null;
    // Null: they can apply again at once, as when the team asked to hear more about their work.
    const appliesAgainOn = found.appliesAgainAt > Date.now() ? new Date(found.appliesAgainAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
    try {
      await sendInvitationEmail(mail, {
        senderName: found.libraryName,
        senderEmail: found.contactEmail,
        to: found.applicant.email,
        subject: accepted ? `You're in: ${found.libraryName}` : `Your application to ${found.libraryName}`,
        html: renderApplicationAnswer({ identity: { ...found.emailIdentity, baseUrl: found.emailIdentity.baseUrl ?? origin }, accepted, reason, appliesAgainOn, url }),
        text: accepted
          ? `Your application to join ${found.libraryName} was accepted. You're a Creator: add papers, edit records, upload files and submit your work for review.\n\n${url}`
          : `Your application to join ${found.libraryName} wasn't accepted.${reason ? `\n\nTheir reason:\n${reason}` : ""}\n\n${appliesAgainOn ? `You can apply again from ${appliesAgainOn}.` : "You can apply again now, with more about your work."}\n\n${url}`,
      });
    } catch (error) {
      console.error("Community application answer email failed", { applicationId, error });
    }
    return null;
  },
});
