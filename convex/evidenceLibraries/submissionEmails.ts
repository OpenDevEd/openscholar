"use node";

// The email to someone who sent a paper to a community, once its team answers (./submissions.ts schedules it).
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { requireAppUrl } from "../lib/env";
import { requireInvitationMail, sendInvitationEmail } from "../lib/invitationDelivery";
import { renderSuggestionAnswer } from "../../lib/emails/library-suggestion";

/** Tells the sender their paper is live, or that it wasn't added and why. Until this, only Your submissions said so. */
export const toSender = internalAction({
  args: { submissionId: v.id("paperSubmissions"), /** The community's word this email is for. */ generation: v.number() },
  returns: v.null(),
  handler: async (ctx, { submissionId, generation }) => {
    const found = await ctx.runQuery(internal.evidenceLibraries.submissions.readForEmail, { submissionId, generation });
    // Gone, or the community has said something newer since: nothing of this answer to tell.
    if (!found) return null;
    const origin = requireAppUrl();
    const published = found.status === "published";
    // The record on the community once it's live there; where its submissions are listed otherwise.
    const url = (published && found.recordLink) || new URL("/evidence-communities?view=submissions", origin).href;
    const { paper } = found;
    try {
      await sendInvitationEmail(requireInvitationMail(), {
        senderName: found.libraryName,
        senderEmail: found.contactEmail,
        to: found.to,
        subject: published ? `Your suggestion is live: ${paper.title}` : `About the paper you suggested to ${found.libraryName}`,
        html: renderSuggestionAnswer({ identity: { ...found.emailIdentity, baseUrl: found.emailIdentity.baseUrl ?? origin }, paper, published, reason: found.note, url }),
        text: published
          ? `${found.libraryName} published a paper you suggested: ${paper.title}.\n\n${url}`
          : `${found.libraryName} didn't add a paper you suggested: ${paper.title}.${found.note ? `\n\nTheir reason:\n${found.note}` : ""}\n\n${url}`,
      });
    } catch (error) {
      console.error("Paper suggestion answer email failed", { submissionId, error });
    }
    return null;
  },
});
