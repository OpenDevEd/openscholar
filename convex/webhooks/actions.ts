"use node";
import { action } from "../_generated/server";
import { WorkOS } from "@workos-inc/node";
import Stripe from "stripe";
import { v } from "convex/values";

/**
 * Verifies WorkOS webhook signature and returns parsed event.
 * Must run in Node.js runtime to use WorkOS SDK.
 */
export const verifyWorkosWebhook = action({
  args: {
    payloadText: v.string(),
    signature: v.string(),
  },
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

/**
 * Verifies Stripe webhook signature and returns parsed event.
 * Must run in Node.js runtime to use Stripe SDK.
 */
export const verifyStripeWebhook = action({
  args: {
    payload: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    try {
      const event = stripe.webhooks.constructEvent(
        args.payload,
        args.signature,
        process.env.STRIPE_WEBHOOK_SECRET!
      );

      return {
        success: true as const,
        type: event.type,
        data: event.data.object as unknown as Record<string, unknown>,
      };
    } catch (err) {
      console.error("Stripe webhook verification failed:", err);
      return {
        success: false as const,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  },
});
