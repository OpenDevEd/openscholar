"use node";

import { action } from "../_generated/server";
import { v } from "convex/values";
import { requireActionAuth } from "../lib/auth";
import { internal } from "../_generated/api";
import { components } from "../_generated/api";
import { stripeClient } from "../stripe";
import {
  assertPlanPriceConfig,
  getPlanFromPriceId,
  getPlanPriceIds,
  getPlanTier,
  getPlanTypeFromMetadata,
  isAllowedPriceId,
} from "../lib/constants";
import { planValidator } from "../lib/validators";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "dummy", {
  apiVersion: "2026-01-28.clover",
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
    const identity = await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internal.users.internal.getCurrentUser);

    assertPlanPriceConfig();

    if (args.organizationId) {
      await ctx.runQuery(internal.memberships.internal.getMembershipForUser, {
        userId: user._id,
        organizationId: args.organizationId,
        requiredRole: "admin",
      });
    }

    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: args.organizationId ?? user._id,
      email: identity.email,
      name: identity.name,
    });

    const metadata: Record<string, string> = {
      userId: user._id,
    };

    if (args.organizationId) {
      metadata.organizationId = args.organizationId;
    }

    if (!isAllowedPriceId(args.priceId)) {
      throw new Error("Invalid price ID");
    }

    const session = await stripeClient.createCheckoutSession(ctx, {
      priceId: args.priceId,
      customerId: customer.customerId,
      mode: args.mode,
      quantity: args.quantity ?? 1,
      successUrl: `${DOMAIN}/settings/billing?success=true`,
      cancelUrl: `${DOMAIN}/settings/billing?canceled=true`,
      metadata,
      subscriptionMetadata: args.mode === "subscription" ? metadata : undefined,
      paymentIntentMetadata: args.mode === "payment" ? metadata : undefined,
    });

    return { url: session.url };
  },
});

export const getPlans = action({
  args: {
    priceIds: v.optional(v.array(v.string())),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      amount: v.union(v.number(), v.null()),
      currency: v.string(),
      interval: v.optional(v.string()),
      nickname: v.union(v.string(), v.null()),
      metadata: v.record(v.string(), v.string()),
      plan: planValidator,
    })
  ),
  handler: async (ctx, args) => {
    const defaultPriceIds = Object.values(getPlanPriceIds()).filter((id) =>
      isAllowedPriceId(id)
    );
    const priceIds = args.priceIds && args.priceIds.length > 0
      ? args.priceIds.filter((id) => isAllowedPriceId(id))
      : defaultPriceIds;

    if (priceIds.length === 0) {
      return [];
    }

    const prices = await Promise.all(
      priceIds.map(async (id) => {
        try {
          const price = await stripe.prices.retrieve(id);
          const metadata = price.metadata as Record<string, string>;
          return {
            id: price.id,
            amount: price.unit_amount,
            currency: price.currency,
            interval: price.recurring?.interval,
            nickname: price.nickname,
            metadata,
            plan: getPlanTypeFromMetadata(metadata) ?? getPlanFromPriceId(price.id),
          };
        } catch (error) {
          console.error(`Failed to fetch price ${id}:`, error);
          return null;
        }
      })
    );

    return prices.filter((price): price is Exclude<typeof price, null> => price !== null);
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

    if (args.organizationId) {
      await ctx.runQuery(internal.memberships.internal.getMembershipForUser, {
        userId: user._id,
        organizationId: args.organizationId,
        requiredRole: "member",
      });
    }

    const ownerId = args.organizationId ?? user._id;

    const subscriptions = await ctx.runQuery(
      components.stripe.public.listSubscriptionsByUserId,
      { userId: ownerId }
    );

    if (subscriptions.length === 0) {
      throw new Error("No subscription found");
    }

    const portal = await stripeClient.createCustomerPortalSession(ctx, {
      customerId: subscriptions[0].stripeCustomerId,
      returnUrl: `${DOMAIN}/settings/billing`,
    });

    return { url: portal.url };
  },
});

/**
 * Cancel subscription immediately
 */
export const cancelImmediately = action({
  args: {
    organizationId: v.optional(v.id("organizations")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internal.users.internal.getCurrentUser);

    if (args.organizationId) {
      await ctx.runQuery(internal.memberships.internal.getMembershipForUser, {
        userId: user._id,
        organizationId: args.organizationId,
        requiredRole: "admin",
      });
    }

    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";

    const subscription = await ctx.runQuery(
      internal.subscriptions.internal.getSubscriptionByOwner,
      {
        ownerId,
        ownerType,
      }
    );

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw new Error("No active subscription found to cancel");
    }

    await stripe.subscriptions.cancel(subscription.stripeSubscriptionId, {
      prorate: true,
    });

    return null;
  },
});

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

    const subscription = await ctx.runQuery(
      internal.subscriptions.internal.getSubscriptionByOwner,
      {
        ownerId: user._id,
        ownerType: "user",
      }
    );

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

      const sub = stripeSub as any;

      if (!sub.items?.data?.[0]?.price) {
        console.error("Missing price data structure", sub);
        return { status: "error", error: "No price data in subscription." };
      }

      const price = sub.items.data[0].price;
      const paymentMethod = sub.default_payment_method as Stripe.PaymentMethod | null;

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
        },
      };
    } catch (error: any) {
      console.error("Failed to fetch Stripe subscription:", error);

      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        return { status: "error", error: "Subscription not found or invalid." };
      }
      if (error instanceof Stripe.errors.StripeAuthenticationError) {
        return {
          status: "error",
          error: "Stripe authentication failed. Please contact support.",
        };
      }
      if (error instanceof Stripe.errors.StripeConnectionError) {
        return { status: "error", error: "Network error. Please try again." };
      }
      if (error instanceof Stripe.errors.StripeRateLimitError) {
        return { status: "error", error: "Too many requests. Please try again later." };
      }

      return { status: "error", error: error.message || "Stripe API failed" };
    }
  },
});

/**
 * Schedule a downgrade to a lower tier plan
 * Cancels current subscription at period end and schedules new subscription
 */
export const scheduleDowngrade = action({
  args: {
    targetPriceId: v.string(),
    organizationId: v.optional(v.id("organizations")),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
    effectiveDate: v.optional(v.number()),
  }),
  handler: async (ctx, args): Promise<{
    success: boolean;
    message: string;
    effectiveDate?: number;
  }> => {
    await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internal.users.internal.getCurrentUser);

    if (args.organizationId) {
      await ctx.runQuery(internal.memberships.internal.getMembershipForUser, {
        userId: user._id,
        organizationId: args.organizationId,
        requiredRole: "admin",
      });
    }

    // Verify target price ID is valid
    if (!isAllowedPriceId(args.targetPriceId)) {
      return { success: false, message: "Invalid target price ID" };
    }

    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";

    // Get current subscription
    const subscription = await ctx.runQuery(
      internal.subscriptions.internal.getSubscriptionByOwner,
      {
        ownerId,
        ownerType,
      }
    );

    if (!subscription || !subscription.stripeSubscriptionId) {
      return { success: false, message: "No active subscription found" };
    }

    // Verify this is actually a downgrade
    const currentTier = getPlanTier(subscription.plan);
    const targetPlan = getPlanFromPriceId(args.targetPriceId);
    const targetTier = getPlanTier(targetPlan);

    if (targetTier >= currentTier) {
      return { success: false, message: "Target plan is not a downgrade. Use upgrade flow instead." };
    }

    try {
      // Get current Stripe subscription to access metadata and period end
      const stripeSubscription = await stripe.subscriptions.retrieve(
        subscription.stripeSubscriptionId
      );

      // Update Stripe subscription to cancel at period end
      const updatedSubscription = await stripe.subscriptions.update(
        subscription.stripeSubscriptionId,
        {
          cancel_at_period_end: true,
          metadata: {
            ...(stripeSubscription.metadata || {}),
            pendingDowngrade: "true",
            targetPriceId: args.targetPriceId,
            targetPlan: targetPlan,
          },
        }
      );

      const effectiveDate = ((updatedSubscription as any).current_period_end || 0) * 1000;

      return {
        success: true,
        message: `Downgrade scheduled. Your ${targetPlan} plan will begin on ${new Date(effectiveDate).toLocaleDateString()}`,
        effectiveDate,
      };
    } catch (error: any) {
      console.error("Failed to schedule downgrade:", error);
      return {
        success: false,
        message: error.message || "Failed to schedule downgrade",
      };
    }
  },
});
