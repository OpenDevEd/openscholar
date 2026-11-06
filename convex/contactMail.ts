"use node";
// Sends a contact form message (./contact.ts) to the team's inbox through the platform's mail service. Replies go to
// whoever wrote it.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { requireInvitationMail, sendInvitationEmail } from "./lib/invitationDelivery";
import { CONTACT_EMAIL } from "../lib/billing/contact";
import { contactEmail, type ContactMessage } from "../lib/contact";

export const deliver = internalAction({
  args: {
    message: v.object({
      topic: v.union(v.literal("community"), v.literal("southern"), v.literal("partner"), v.literal("account"), v.literal("bug"), v.literal("other")),
      name: v.string(),
      email: v.string(),
      org: v.optional(v.string()),
      country: v.optional(v.string()),
      project: v.optional(v.string()),
      message: v.optional(v.string()),
    }),
  },
  returns: v.null(),
  handler: async (_ctx, { message }: { message: ContactMessage }) => {
    await sendInvitationEmail(requireInvitationMail(), { senderName: `${message.name} via Openscholar`, replyTo: message.email, to: CONTACT_EMAIL, ...contactEmail(message) });
    return null;
  },
});
