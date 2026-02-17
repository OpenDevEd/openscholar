"use node";

import { action, type ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { requireActionAuth } from "../lib/auth";
import { internal, components } from "../_generated/api";
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
import { normalizeStripeSubscriptionStatus } from "./lib/stripeStatus";
import { isSubscriptionScheduledToCancel } from "./lib/cancellation";
import {
  buildDowngradeSchedulePhases,
  determineChangeType,
  findPendingScheduleChange,
  getScheduleId,
  isReleasableScheduleStatus,
  resolveCurrentPhaseBounds,
  shouldReleaseScheduleForChange,
  type ChangeType,
  type ScheduleLike,
} from "./lib/schedulePlanning";
import { isEntitledStatus } from "../../lib/billing/entitlements";

const internalApi = internal as any;
const componentApi = components as any;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "dummy", {
  apiVersion: "2026-01-28.clover",
});

const DOMAIN =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_URL ||
  "http://localhost:3000";

function getStripeCustomerId(subscription: any): string | null {
  if (!subscription.customer) return null;
  if (typeof subscription.customer === "string") return subscription.customer;
  return subscription.customer.id ?? null;
}

function clearPendingPlanMetadata(
  metadata: Record<string, string> | Stripe.Metadata | null | undefined,
): Record<string, string> {
  return {
    ...(metadata ?? {}),
    pendingPlanChange: "",
    pendingTargetPriceId: "",
    pendingTargetPlan: "",
  };
}

async function getAttachedSchedule(
  subscription: any,
): Promise<Stripe.SubscriptionSchedule | null> {
  const scheduleRef = subscription.schedule;
  const scheduleId = getScheduleId(scheduleRef);
  if (!scheduleId) return null;

  if (
    typeof scheduleRef !== "string" &&
    scheduleRef &&
    typeof scheduleRef === "object" &&
    scheduleRef.id
  ) {
    return scheduleRef as Stripe.SubscriptionSchedule;
  }

  return await stripe.subscriptionSchedules.retrieve(scheduleId);
}

async function syncLocalSubscriptionFromStripe(
  ctx: ActionCtx,
  subscription: any,
): Promise<void> {
  const item = subscription.items.data[0];
  const stripeCustomerId = getStripeCustomerId(subscription);

  if (!item?.price?.id || !stripeCustomerId) {
    throw new Error("Stripe subscription is missing required item or customer data");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const currentPeriodEndSec =
    subscription.current_period_end ??
    item.current_period_end ??
    nowSec + 30 * 24 * 60 * 60;
  const currentPeriodStartSec =
    subscription.current_period_start ?? item.current_period_start ?? nowSec;
  const cancelAtPeriodEnd = isSubscriptionScheduledToCancel({
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    cancelAt: subscription.cancel_at ?? null,
    currentPeriodEnd: currentPeriodEndSec,
    nowUnixSeconds: nowSec,
  });

  await ctx.runMutation(internalApi.subscriptions.internal.syncSubscription, {
    stripeSubscriptionId: subscription.id,
    stripeCustomerId,
    status: normalizeStripeSubscriptionStatus(subscription.status),
    currentPeriodStart: currentPeriodStartSec * 1000,
    currentPeriodEnd: currentPeriodEndSec * 1000,
    cancelAtPeriodEnd,
    priceId: item.price.id,
    quantity: item.quantity,
    metadata: subscription.metadata as Record<string, string>,
  });
}

/**
 * Create a Stripe Checkout session for a first-time subscription purchase.
 */
export const createCheckoutSession = action({
  args: {
    priceId: v.string(),
    quantity: v.optional(v.number()),
  },
  returns: v.object({
    url: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    const identity = await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internalApi.users.internal.getCurrentUser);

    assertPlanPriceConfig();

    if (!isAllowedPriceId(args.priceId)) {
      throw new Error("Invalid price ID");
    }

    const targetPlan = getPlanFromPriceId(args.priceId);
    if (targetPlan === "free") {
      throw new Error("Cannot create checkout session for free plan");
    }

    const existingSubscription = await ctx.runQuery(
      internalApi.subscriptions.internal.getSubscriptionByOwner,
      {
        ownerId: user._id,
        ownerType: "user",
      },
    );

    if (existingSubscription?.stripeSubscriptionId && existingSubscription.status !== "canceled") {
      throw new Error("Existing Stripe subscription found. Use changePlan or billing portal.");
    }

    const customer = await stripeClient.getOrCreateCustomer(ctx, {
      userId: user._id,
      email: identity.email,
      name: identity.name,
    });

    await ctx.runMutation(internalApi.subscriptions.internal.upsertBillingCustomerLink, {
      userId: user._id,
      stripeCustomerId: customer.customerId,
      linkedFrom: "checkout_session",
    });

    const metadata: Record<string, string> = {
      userId: user._id,
    };

    const session = await stripeClient.createCheckoutSession(ctx, {
      priceId: args.priceId,
      customerId: customer.customerId,
      mode: "subscription",
      quantity: args.quantity ?? 1,
      successUrl: `${DOMAIN}/settings/billing?success=true`,
      cancelUrl: `${DOMAIN}/settings/billing?canceled=true`,
      metadata,
      subscriptionMetadata: metadata,
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
    }),
  ),
  handler: async (_ctx, args) => {
    const defaultPriceIds = Object.values(getPlanPriceIds()).filter((id) =>
      isAllowedPriceId(id),
    );
    const priceIds =
      args.priceIds && args.priceIds.length > 0
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
      }),
    );

    return prices.filter((price): price is Exclude<typeof price, null> => price !== null);
  },
});

/**
 * Create a Stripe Customer Portal session for managing subscriptions.
 */
export const createPortalSession = action({
  args: {},
  returns: v.object({
    url: v.string(),
  }),
  handler: async (ctx): Promise<{ url: string }> => {
    await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internalApi.users.internal.getCurrentUser);

    const billingCustomer = await ctx.runQuery(
      internalApi.subscriptions.internal.getBillingCustomerByUser,
      {
        userId: user._id,
      },
    );

    const subscription = await ctx.runQuery(
      internalApi.subscriptions.internal.getSubscriptionByOwner,
      {
        ownerId: user._id,
        ownerType: "user",
      },
    );

    let stripeCustomerId =
      billingCustomer?.stripeCustomerId ?? subscription?.stripeCustomerId;

    if (!stripeCustomerId) {
      const componentSubscriptions = await ctx.runQuery(
        componentApi.stripe.public.listSubscriptionsByUserId,
        { userId: user._id },
      );
      stripeCustomerId = componentSubscriptions[0]?.stripeCustomerId;
    }

    if (stripeCustomerId) {
      await ctx.runMutation(internalApi.subscriptions.internal.upsertBillingCustomerLink, {
        userId: user._id,
        stripeCustomerId,
        linkedFrom: "portal_session",
      });
    }

    if (!stripeCustomerId) {
      throw new Error("No subscription customer found");
    }

    const portal = await stripeClient.createCustomerPortalSession(ctx, {
      customerId: stripeCustomerId,
      returnUrl: `${DOMAIN}/settings/billing`,
    });

    return { url: portal.url };
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
        currentPriceId: v.string(),
        status: v.string(),
        entitlementState: v.union(
          v.literal("entitled"),
          v.literal("payment_pending"),
          v.literal("not_entitled"),
        ),
        entitlementMessage: v.optional(v.string()),
        cancelAtPeriodEnd: v.boolean(),
        hasPendingChange: v.boolean(),
        pendingTargetPriceId: v.optional(v.string()),
        pendingTargetPlan: v.optional(planValidator),
        pendingEffectiveDate: v.optional(v.number()),
        cardBrand: v.optional(v.string()),
        cardLast4: v.optional(v.string()),
      }),
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
      currentPriceId: string;
      status: string;
      entitlementState: "entitled" | "payment_pending" | "not_entitled";
      entitlementMessage?: string;
      cancelAtPeriodEnd: boolean;
      hasPendingChange: boolean;
      pendingTargetPriceId?: string;
      pendingTargetPlan?: "free" | "go" | "pro" | "enterprise";
      pendingEffectiveDate?: number;
      cardBrand?: string;
      cardLast4?: string;
    };
    error?: string;
  }> => {
    await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internalApi.users.internal.getCurrentUser);

    const subscription = await ctx.runQuery(
      internalApi.subscriptions.internal.getSubscriptionByOwner,
      {
        ownerId: user._id,
        ownerType: "user",
      },
    );

    if (!subscription || !subscription.stripeSubscriptionId) {
      return { status: "error", error: "No subscription linked." };
    }

    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, {
        expand: ["default_payment_method", "schedule"],
      });

      const sub = stripeSub as any;

      if (!sub.items?.data?.[0]?.price) {
        return { status: "error", error: "No price data in subscription." };
      }

      const price = sub.items.data[0].price;
      const paymentMethod = sub.default_payment_method as Stripe.PaymentMethod | null;
      const currentPeriodEnd = sub.current_period_end || sub.items.data[0].current_period_end;
      const cancelAtPeriodEnd = isSubscriptionScheduledToCancel({
        cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        cancelAt: sub.cancel_at ?? null,
        currentPeriodEnd,
      });
      const schedule = await getAttachedSchedule(sub);
      const pendingChange = findPendingScheduleChange({
        schedule: schedule as unknown as ScheduleLike,
        currentPriceId: price.id,
      });
      const pendingTargetPlan = pendingChange.targetPriceId
        ? getPlanFromPriceId(pendingChange.targetPriceId)
        : undefined;
      const entitlementState: "entitled" | "payment_pending" | "not_entitled" =
        sub.status === "incomplete"
          ? "payment_pending"
          : isEntitledStatus(sub.status)
            ? "entitled"
            : "not_entitled";
      const entitlementMessage =
        entitlementState === "payment_pending"
          ? "Payment is pending. Complete payment in Stripe Billing Portal to activate credits."
          : entitlementState === "not_entitled"
            ? "Subscription is not currently entitled."
            : undefined;

      return {
        status: "success",
        data: {
          amount: price.unit_amount || 0,
          currency: price.currency,
          interval: price.recurring?.interval || "month",
          currentPeriodEnd: currentPeriodEnd ? currentPeriodEnd * 1000 : Date.now(),
          currentPriceId: price.id,
          status: sub.status,
          entitlementState,
          entitlementMessage,
          cancelAtPeriodEnd,
          hasPendingChange: pendingChange.hasPendingChange,
          pendingTargetPriceId: pendingChange.targetPriceId,
          pendingTargetPlan,
          pendingEffectiveDate:
            typeof pendingChange.effectiveDate === "number"
              ? pendingChange.effectiveDate * 1000
              : undefined,
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
 * Change plan for an existing subscription.
 * - Upgrades are applied immediately with proration.
 * - Downgrades are scheduled to apply at period end.
 */
export const changePlan = action({
  args: {
    targetPriceId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    mode: v.union(v.literal("updated"), v.literal("scheduled")),
    changeType: v.union(
      v.literal("upgraded_immediately"),
      v.literal("downgrade_scheduled"),
      v.literal("pending_change_cleared"),
      v.literal("no_change"),
    ),
    message: v.string(),
    effectiveDate: v.optional(v.number()),
  }),
  handler: async (ctx, args): Promise<{
    success: boolean;
    mode: "updated" | "scheduled";
    changeType: ChangeType;
    message: string;
    effectiveDate?: number;
  }> => {
    await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internalApi.users.internal.getCurrentUser);

    if (!isAllowedPriceId(args.targetPriceId)) {
      throw new Error("Invalid target price ID");
    }

    const targetPlan = getPlanFromPriceId(args.targetPriceId);
    if (targetPlan === "free") {
      throw new Error("Use billing portal to cancel to free plan");
    }

    try {
      const subscription = await ctx.runQuery(
        internalApi.subscriptions.internal.getSubscriptionByOwner,
        {
          ownerId: user._id,
          ownerType: "user",
        },
      );

      if (!subscription || !subscription.stripeSubscriptionId) {
        throw new Error("No active Stripe subscription found");
      }

      const stripeSubscription: any = await stripe.subscriptions.retrieve(
        subscription.stripeSubscriptionId,
        {
          expand: ["schedule"],
        },
      );

      const item = stripeSubscription.items.data[0];
      if (!item?.id || !item.price?.id) {
        throw new Error("Current subscription item not found");
      }

      const currentPlan = getPlanFromPriceId(item.price.id || undefined);
      const currentTier = getPlanTier(currentPlan);
      const targetTier = getPlanTier(targetPlan);

      let schedule = await getAttachedSchedule(stripeSubscription);
      const pendingChange = findPendingScheduleChange({
        schedule: schedule as unknown as ScheduleLike,
        currentPriceId: item.price.id,
      });
      const hasClearablePendingChange =
        pendingChange.hasPendingChange &&
        Boolean(
          schedule &&
            shouldReleaseScheduleForChange({
              changeType: "pending_change_cleared",
              scheduleStatus: schedule.status,
            }),
        );

      const changeType = determineChangeType({
        currentTier,
        targetTier,
        hasPendingScheduledChange: hasClearablePendingChange,
      });

      if (changeType === "no_change") {
        return {
          success: true,
          mode: "updated",
          changeType,
          message: `You are already on the ${targetPlan} plan.`,
        };
      }

      if (changeType === "pending_change_cleared") {
        if (
          schedule &&
          shouldReleaseScheduleForChange({
            changeType,
            scheduleStatus: schedule.status,
          })
        ) {
          await stripe.subscriptionSchedules.release(schedule.id);
        }

        const metadataCleared = await stripe.subscriptions.update(stripeSubscription.id, {
          metadata: clearPendingPlanMetadata(stripeSubscription.metadata || {}),
        });
        await syncLocalSubscriptionFromStripe(ctx, metadataCleared);

        return {
          success: true,
          mode: "updated",
          changeType,
          message: `Pending plan change cleared. You remain on ${targetPlan}.`,
        };
      }

      if (changeType === "upgraded_immediately") {
        if (
          schedule &&
          shouldReleaseScheduleForChange({
            changeType,
            scheduleStatus: schedule.status,
          })
        ) {
          await stripe.subscriptionSchedules.release(schedule.id);
        }

        const updated = await stripe.subscriptions.update(stripeSubscription.id, {
          items: [
            {
              id: item.id,
              price: args.targetPriceId,
              quantity: item.quantity ?? 1,
            },
          ],
          proration_behavior: "create_prorations",
          cancel_at_period_end: false,
          metadata: clearPendingPlanMetadata(stripeSubscription.metadata || {}),
        });

        await syncLocalSubscriptionFromStripe(ctx, updated);

        return {
          success: true,
          mode: "updated",
          changeType,
          message: `Plan changed to ${targetPlan}.`,
        };
      }

      if (!schedule || !isReleasableScheduleStatus(schedule.status)) {
        schedule = await stripe.subscriptionSchedules.create({
          from_subscription: stripeSubscription.id,
        });
      }

      const fallbackCurrentPeriodEnd =
        stripeSubscription.current_period_end ?? item.current_period_end;
      if (!fallbackCurrentPeriodEnd) {
        throw new Error("Unable to determine current period end for downgrade");
      }

      const fallbackCurrentPeriodStart =
        stripeSubscription.current_period_start ??
        item.current_period_start ??
        Math.floor(Date.now() / 1000);
      const { startDate, endDate } = resolveCurrentPhaseBounds({
        schedule: schedule as unknown as ScheduleLike,
        fallbackStart: fallbackCurrentPeriodStart,
        fallbackEnd: fallbackCurrentPeriodEnd,
      });

      await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: "release",
        proration_behavior: "none",
        phases: buildDowngradeSchedulePhases({
          currentPhaseStart: startDate,
          currentPhaseEnd: endDate,
          currentPriceId: item.price.id,
          currentQuantity: item.quantity,
          targetPriceId: args.targetPriceId,
          targetQuantity: item.quantity,
        }),
      });

      const metadataCleared = await stripe.subscriptions.update(stripeSubscription.id, {
        metadata: clearPendingPlanMetadata(stripeSubscription.metadata || {}),
      });
      await syncLocalSubscriptionFromStripe(ctx, metadataCleared);

      return {
        success: true,
        mode: "scheduled",
        changeType,
        message: `Downgrade to ${targetPlan} scheduled for period end.`,
        effectiveDate: endDate * 1000,
      };
    } catch (error: any) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        console.error("[changePlan] Stripe invalid request", {
          requestId: error.requestId,
          code: error.code,
          param: error.param,
          message: error.message,
          targetPriceId: args.targetPriceId,
          userId: user._id,
        });
        throw new Error(
          "Unable to update your plan due to a Stripe billing conflict. Please retry or use the billing portal.",
        );
      }
      throw error;
    }
  },
});
