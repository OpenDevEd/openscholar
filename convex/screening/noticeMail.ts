"use node";
// Sending a screening's emails (./notices.ts), which needs Node.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { requireAppUrl } from "../lib/env";
import { requireInvitationMail, sendInvitationEmail } from "../lib/invitationDelivery";
import { screeningNoticeMessage } from "../../lib/emails/screening-notice";
import { aboutValidator } from "./notices";

/** Sends one person one email about a screening, saying what waits for them as it stands when the email goes. Nothing is sent where nothing waits. */
export const send = internalAction({
  args: { jobId: v.id("screeningJobs"), userId: v.id("users"), about: aboutValidator, by: v.optional(v.id("users")) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const notice = await ctx.runQuery(internal.screening.notices.context, args);
    // Conflicts settled before their email went: none went, so the day it holds the next one back is let go.
    if (!notice) {
      if (args.about === "conflicts") await ctx.runMutation(internal.screening.notices.conflictsUnsent, { jobId: args.jobId, userId: args.userId });
      return null;
    }
    try {
      await sendInvitationEmail(requireInvitationMail(), { senderName: "Openscholar", to: notice.email, ...screeningNoticeMessage({ origin: requireAppUrl(), path: notice.path, name: notice.name, about: args.about, count: notice.count, ...(notice.finished ? { finished: true } : {}), ...(notice.living ? { living: true } : {}), ...(notice.by ? { by: notice.by } : {}) }) });
    } catch (error) {
      // An email that didn't go changes nothing in the screening: what it said is on its page.
      console.error("Screening email failed", { jobId: args.jobId, about: args.about, error });
    }
    return null;
  },
});
