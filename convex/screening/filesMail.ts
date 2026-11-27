"use node";
// Sending a screening's files by email (./sending.ts), which needs Node.

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { createError } from "../lib/errors";
import { requireAppUrl } from "../lib/env";
import { requireInvitationMail, sendInvitationEmail } from "../lib/invitationDelivery";
import { screeningFilesMessage } from "../../lib/emails/screening-files";

/** Mails a screening's files to one address, replies going to whoever sent them. */
export const send = internalAction({
  args: { to: v.string(), by: v.string(), replyTo: v.optional(v.string()), name: v.string(), path: v.string(), note: v.optional(v.string()), files: v.array(v.object({ name: v.string(), type: v.string(), body: v.string() })) },
  returns: v.null(),
  handler: async (_ctx, { to, by, replyTo, name, path, note, files }): Promise<null> => {
    try {
      await sendInvitationEmail(requireInvitationMail(), { senderName: `${by} via Openscholar`, ...(replyTo ? { replyTo } : {}), to, attachments: files.map((one) => ({ filename: one.name, contentType: one.type, content: Buffer.from(one.body, "utf8") })), ...screeningFilesMessage({ origin: requireAppUrl(), path, name, by, files: files.map((one) => one.name), ...(note ? { note } : {}) }) });
    } catch (error) {
      // What the mail service said is for the logs: the sender is told the email didn't go.
      console.error("Screening files email failed", { files: files.length, error });
      throw createError("EXTERNAL_SERVICE_ERROR", "The email didn't go. Try again, or download the files.");
    }
    return null;
  },
});
