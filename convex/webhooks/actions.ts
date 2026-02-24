"use node";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { Webhook } from "svix";

/**
 * Verifies Clerk webhook signature and returns parsed event.
 */
export const verifyClerkWebhook = internalAction({
  args: {
    payloadText: v.string(),
    svixId: v.string(),
    svixTimestamp: v.string(),
    svixSignature: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      eventId: v.string(),
      eventType: v.string(),
      data: v.any(),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (_ctx, args) => {
    const webhookSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    if (!webhookSecret) {
      return {
        success: false as const,
        error:
          "CLERK_WEBHOOK_SIGNING_SECRET is not configured for webhook verification.",
      };
    }

    try {
      const webhook = new Webhook(webhookSecret);
      const verified = webhook.verify(args.payloadText, {
        "svix-id": args.svixId,
        "svix-timestamp": args.svixTimestamp,
        "svix-signature": args.svixSignature,
      }) as Record<string, unknown>;

      const eventId = verified.id;
      const eventType = verified.type;
      const data = verified.data;

      if (typeof eventId !== "string" || typeof eventType !== "string") {
        return {
          success: false as const,
          error: "Verified webhook payload is missing id/type.",
        };
      }

      return {
        success: true as const,
        eventId,
        eventType,
        data: data ?? {},
      };
    } catch (err) {
      console.error("Clerk webhook verification failed:", err);
      return {
        success: false as const,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },
});
