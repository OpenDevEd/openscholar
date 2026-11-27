"use node";
// Sending a screening's files by email (./sending.ts), which needs Node.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { requireAppUrl } from "../lib/env";
import { requireInvitationMail, sendInvitationEmail } from "../lib/invitationDelivery";
import { screeningFilesMessage } from "../../lib/emails/screening-files";

/** Mails a screening's files to one address, replies going to whoever sent them, and lets the files go either way. */
export const send = internalAction({
  args: { to: v.string(), by: v.string(), replyTo: v.optional(v.string()), name: v.string(), path: v.string(), note: v.optional(v.string()), files: v.array(v.object({ name: v.string(), type: v.string(), file: v.id("_storage") })) },
  returns: v.null(),
  handler: async (ctx, { to, by, replyTo, name, path, note, files }): Promise<null> => {
    try {
      const attachments = await Promise.all(files.map(async (one) => {
        const blob = await ctx.storage.get(one.file);
        if (!blob) throw new Error(`File ${one.name} is gone`);
        return { filename: one.name, contentType: one.type, content: Buffer.from(await blob.arrayBuffer()) };
      }));
      await sendInvitationEmail(requireInvitationMail(), { senderName: `${by} via Openscholar`, ...(replyTo ? { replyTo } : {}), to, attachments, ...screeningFilesMessage({ origin: requireAppUrl(), path, name, by, files: files.map((one) => one.name), ...(note ? { note } : {}) }) });
    } catch (error) {
      // The sender was told it went once it was asked for: what failed is in the logs.
      console.error("Screening files email failed", { to, files: files.length, error });
    } finally {
      await ctx.runMutation(internal.screening.sending.dropFiles, { files: files.map((one) => one.file) });
    }
    return null;
  },
});
