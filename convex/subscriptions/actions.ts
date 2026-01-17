"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { requireActionAuth } from "../lib/auth";
import { internal } from "../_generated/api";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const DOMAIN = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";

/**
 * Create a Stripe Checkout session for a subscription or one-time payment
 */
export const createCheckoutSession = action({
  args: {
    priceId: v.string(),
    mode: v.union(v.literal("subscription"), v.literal("payment")),
    organizationId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    // 1. Verify authenticated
    await requireActionAuth(ctx);
    
    // 2. Get full user doc via internal query
    const user: any = await ctx.runQuery(internal.users.internal.getCurrentUser);
    
    // Determine metadata
    const metadata: Record<string, string> = {
      userId: user._id,
    };
    
    if (args.organizationId) {
      metadata.organizationId = args.organizationId;
    }

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price: args.priceId,
          quantity: 1,
        },
      ],
      mode: args.mode,
      success_url: `${DOMAIN}/settings/billing?success=true`,
      cancel_url: `${DOMAIN}/settings/billing?canceled=true`,
      metadata,
      customer_email: user.email,
      allow_promotion_codes: true,
    });

    return { url: session.url };
  },
});

/**
 * Create a Stripe Customer Portal session for managing subscriptions
 */
export const createPortalSession = action({
  args: {
    organizationId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internal.users.internal.getCurrentUser);
    
    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";
    
    // Get subscription to find Stripe Customer ID
    const subscription = await ctx.runQuery(internal.subscriptions.internal.getSubscriptionByOwner, {
      ownerId,
      ownerType,
    });
    
    if (!subscription || !subscription.stripeCustomerId) {
      throw new Error("No subscription found");
    }
    
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${DOMAIN}/settings/billing`,
    });
    
    return { url: session.url };
  },
});
