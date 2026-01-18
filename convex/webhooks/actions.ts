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
      event: v.string(),
      data: v.any(),
    }),
    v.object({
      success: v.literal(false),
      error: v.string(),
    })
  ),
  handler: async (ctx, args) => {
    const workos = new WorkOS(process.env.WORKOS_API_KEY!);

    try {
      const payload = JSON.parse(args.payloadText) as Record<string, unknown>;

      const webhook = await workos.webhooks.constructEvent({
        payload,
        sigHeader: args.signature,
        secret: process.env.WORKOS_WEBHOOK_SECRET!,
      });

      return {
        success: true as const,
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

