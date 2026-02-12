"use node";
import { internalAction } from "../_generated/server";
import { WorkOS } from "@workos-inc/node";
import { v } from "convex/values";

/**
 * Verifies WorkOS webhook signature and returns parsed event.
 * Must run in Node.js runtime to use WorkOS SDK.
 */
export const verifyWorkosWebhook = internalAction({
  args: {
    payloadText: v.string(),
    signature: v.string(),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      eventId: v.string(),
      event: v.string(),
      data: v.any(),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (_ctx, args) => {
    const apiKey = process.env.WORKOS_API_KEY;
    if (!apiKey) {
      return {
        success: false as const,
        error: "WORKOS_API_KEY is not configured for webhook verification.",
      };
    }

    const webhookSecret = process.env.WORKOS_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return {
        success: false as const,
        error:
          "WORKOS_WEBHOOK_SECRET is not configured. Set it for local and deployed webhook verification.",
      };
    }

    try {
      const workos = new WorkOS(apiKey);
      const payload = JSON.parse(args.payloadText) as Record<string, unknown>;

      const webhook = await workos.webhooks.constructEvent({
        payload,
        sigHeader: args.signature,
        secret: webhookSecret,
      });

      return {
        success: true as const,
        eventId: webhook.id as string,
        event: webhook.event as string,
        data: webhook.data as Record<string, unknown>,
      };
    } catch (err) {
      console.error("WorkOS webhook verification failed:", err);
      return {
        success: false as const,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },
});
