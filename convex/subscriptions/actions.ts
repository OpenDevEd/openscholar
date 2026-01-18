"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { requireActionAuth } from "../lib/auth";
import { internal } from "../_generated/api";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-12-15.clover",
});

const DOMAIN = process.env.NEXT_PUBLIC_URL || "http://localhost:3000";

/**
 * Create a Stripe Checkout session for a subscription or one-time payment
 */
export const createCheckoutSession = action({
  args: {
    priceId: v.string(),
    mode: v.union(v.literal("subscription"), v.literal("payment")),
    organizationId: v.optional(v.id("organizations")),
    quantity: v.optional(v.number()),
  },
  returns: v.object({
    url: v.union(v.string(), v.null()),
  }),
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

    // 3. Check for existing Stripe customer to prevent duplicates
    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";
    
    const existingSubscription: any = await ctx.runQuery(
      internal.subscriptions.internal.getSubscriptionByOwner,
      { ownerId, ownerType }
    );
    
    const existingCustomerId = existingSubscription?.stripeCustomerId;

    // 4. Create checkout session
    const sessionConfig: any = {
      line_items: [
        {
          price: args.priceId,
          quantity: args.quantity ?? 1,
        },
      ],
      mode: args.mode,
      success_url: `${DOMAIN}/settings/billing?success=true`,
      cancel_url: `${DOMAIN}/settings/billing?canceled=true`,
      metadata,
      allow_promotion_codes: true,
    };

    // Use existing customer if available, otherwise provide email
    if (existingCustomerId) {
      sessionConfig.customer = existingCustomerId;
    } else if (user.email && user.email.length > 0) {
      sessionConfig.customer_email = user.email;
    }

    // Only include subscription_data for subscription mode
    if (args.mode === "subscription") {
      sessionConfig.subscription_data = { metadata };
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return { url: session.url };
  },
});

export const getPlans = action({
  args: {
    priceIds: v.array(v.string()),
  },
  returns: v.array(
    v.union(
      v.object({
        id: v.string(),
        amount: v.union(v.number(), v.null()),
        currency: v.string(),
        interval: v.optional(v.string()),
        nickname: v.union(v.string(), v.null()),
        metadata: v.any(),
      }),
      v.null()
    )
  ),
  handler: async (ctx, args) => {
    const prices = await Promise.all(
      args.priceIds.map(async (id) => {
        try {
          const price = await stripe.prices.retrieve(id);
          return {
            id: price.id,
            amount: price.unit_amount,
            currency: price.currency,
            interval: price.recurring?.interval,
            nickname: price.nickname,
            metadata: price.metadata,
          };
        } catch (error) {
          console.error(`Failed to fetch price ${id}:`, error);
          return null;
        }
      })
    );

    return prices.filter((p) => p !== null);
  },
});

/**
 * Create a Stripe Customer Portal session for managing subscriptions
 */
export const createPortalSession = action({
  args: {
    organizationId: v.optional(v.id("organizations")),
  },
  returns: v.object({
    url: v.string(),
  }),
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

/**
 * Fetch detailed subscription info safely from Stripe
 */
export const getSubscriptionDetails = action({
  args: {},
  returns: v.object({
    status: v.union(v.literal("success"), v.literal("error")),
    data: v.optional(
      v.object({
        amount: v.number(),
        currency: v.string(),
        interval: v.string(),
        currentPeriodEnd: v.number(),
        status: v.string(),
        cancelAtPeriodEnd: v.boolean(),
        cardBrand: v.optional(v.string()),
        cardLast4: v.optional(v.string()),
      })
    ),
    error: v.optional(v.string()),
  }),
  handler: async (ctx): Promise<{
    status: "success" | "error";
    data?: {
      amount: number;
      currency: string;
      interval: string;
      currentPeriodEnd: number;
      status: string;
      cancelAtPeriodEnd: boolean;
      cardBrand?: string;
      cardLast4?: string;
    };
    error?: string;
  }> => {
    await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internal.users.internal.getCurrentUser);
    
    // Get subscription to find Stripe ID
    const subscription = await ctx.runQuery(internal.subscriptions.internal.getSubscriptionByOwner, {
      ownerId: user._id,
      ownerType: "user",
    });

    if (!subscription || !subscription.stripeSubscriptionId) {
      console.error("No stripeSubscriptionId found for user", user._id);
      return { status: "error", error: "No subscription linked." };
    }

    try {
      const stripeSub = await stripe.subscriptions.retrieve(
        subscription.stripeSubscriptionId,
        {
          expand: ["default_payment_method"],
        }
      );

      // Log the object to debug structure
      console.log("Stripe Sub Object:", JSON.stringify(stripeSub, null, 2));

      // Force type assertion if needed, though usually not required
      const sub = stripeSub as any; // Cast to any to debug structure access

      if (!sub.items?.data?.[0]?.price) {
          console.error("Missing price data structure", sub);
          return { status: "error", error: "No price data in subscription." };
      }

      const price = sub.items.data[0].price;
      const paymentMethod = sub.default_payment_method as Stripe.PaymentMethod | null;
      
      // Handle potential missing top-level field in newer API versions
      const currentPeriodEnd = sub.current_period_end || sub.items.data[0].current_period_end;

      return {
        status: "success",
        data: {
          amount: price.unit_amount || 0,
          currency: price.currency,
          interval: price.recurring?.interval || "month",
          currentPeriodEnd: currentPeriodEnd ? currentPeriodEnd * 1000 : Date.now(),
          status: sub.status,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          cardBrand: paymentMethod?.card?.brand,
          cardLast4: paymentMethod?.card?.last4,
        }
      };
    } catch (error: any) {
      console.error("Failed to fetch Stripe subscription:", error);
      
      // Handle specific Stripe error types
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        return { status: "error", error: "Subscription not found or invalid." };
      } else if (error instanceof Stripe.errors.StripeAuthenticationError) {
        return { status: "error", error: "Stripe authentication failed. Please contact support." };
      } else if (error instanceof Stripe.errors.StripeConnectionError) {
        return { status: "error", error: "Network error. Please try again." };
      } else if (error instanceof Stripe.errors.StripeRateLimitError) {
        return { status: "error", error: "Too many requests. Please try again later." };
      }
      
      return { status: "error", error: error.message || "Stripe API failed" };
    }
  },
});
