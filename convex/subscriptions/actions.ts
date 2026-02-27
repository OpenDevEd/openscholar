"use node";

import { action, internalAction, type ActionCtx } from "../_generated/server";
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
  PLAN_CONFIG,
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
import { requireSubscriptionsEnabled } from "../lib/featureFlags";
import { createError, type ErrorCode } from "../lib/errors";

const internalApi = internal as any;
const componentApi = components as any;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "dummy", {
  apiVersion: "2026-01-28.clover",
});

const DOMAIN =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_URL ||
  "http://localhost:3000";

export type SubscriptionDetailsErrorCode = Extract<
  ErrorCode,
  | "BILLING_NO_SUBSCRIPTION_LINKED"
  | "BILLING_SUBSCRIPTION_PRICE_MISSING"
  | "BILLING_SUBSCRIPTION_INVALID"
  | "BILLING_AUTHENTICATION_FAILED"
  | "BILLING_NETWORK_ERROR"
  | "BILLING_RATE_LIMITED"
  | "BILLING_STRIPE_ERROR"
>;

export function mapSubscriptionDetailsErrorCode(
  error: unknown,
): SubscriptionDetailsErrorCode {
  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    return "BILLING_SUBSCRIPTION_INVALID";
  }
  if (error instanceof Stripe.errors.StripeAuthenticationError) {
    return "BILLING_AUTHENTICATION_FAILED";
  }
  if (error instanceof Stripe.errors.StripeConnectionError) {
    return "BILLING_NETWORK_ERROR";
  }
  if (error instanceof Stripe.errors.StripeRateLimitError) {
    return "BILLING_RATE_LIMITED";
  }
  return "BILLING_STRIPE_ERROR";
}

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
    throw createError(
      "BILLING_SUBSCRIPTION_DATA_INVALID",
      "Stripe subscription is missing required item or customer data",
    );
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
 * Re-fetch a subscription from the Stripe API (source of truth) and sync to local DB.
 * Called from webhook handlers to prevent out-of-order event payload corruption (SUB-02).
 *
 * On Stripe API failure, this action throws so that runAuditedStripeHandler marks the
 * event as failed and returns HTTP 500, causing Stripe to retry the webhook.
 */
export const handleSubscriptionWebhook = internalAction({
  args: {
    stripeSubscriptionId: v.string(),
    eventId: v.string(),
    eventStatus: v.optional(v.string()),
    eventPriceId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Re-fetch from Stripe API (source of truth) -- per locked decision
    const fresh = await stripe.subscriptions.retrieve(args.stripeSubscriptionId);

    const freshItem = fresh.items.data[0];

    // Log divergence when event payload disagrees with re-fetched state
    // (groundwork for Phase 3 monitoring)
    if (
      (args.eventStatus && fresh.status !== args.eventStatus) ||
      (args.eventPriceId && freshItem?.price?.id !== args.eventPriceId)
    ) {
      console.warn("[WebhookDivergence]", {
        eventId: args.eventId,
        subscriptionId: args.stripeSubscriptionId,
        divergence: {
          status: { event: args.eventStatus, fresh: fresh.status },
          priceId: {
            event: args.eventPriceId,
            fresh: freshItem?.price?.id,
          },
        },
      });
    }

    // Sync from fresh data, not event payload
    await syncLocalSubscriptionFromStripe(ctx, fresh);

    return null;
  },
});

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
    requireSubscriptionsEnabled();
    const identity = await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internalApi.users.internal.getCurrentUser);

    assertPlanPriceConfig();

    if (!isAllowedPriceId(args.priceId)) {
      throw createError("BILLING_INVALID_PRICE_ID", "Invalid price ID");
    }

    const targetPlan = getPlanFromPriceId(args.priceId);
    if (targetPlan === "free") {
      throw createError(
        "BILLING_FREE_PLAN_CHECKOUT_NOT_ALLOWED",
        "Cannot create checkout session for free plan",
      );
    }

    const existingSubscription = await ctx.runQuery(
      internalApi.subscriptions.internal.getSubscriptionByUser,
      {
        userId: user._id,
      },
    );

    if (existingSubscription?.stripeSubscriptionId && existingSubscription.status !== "canceled") {
      throw createError(
        "BILLING_SUBSCRIPTION_ALREADY_EXISTS",
        "Existing Stripe subscription found. Use changePlan or billing portal.",
      );
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
      internalApi.subscriptions.internal.getSubscriptionByUser,
      {
        userId: user._id,
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
      throw createError("BILLING_CUSTOMER_NOT_FOUND", "No subscription customer found");
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
    errorCode: v.optional(v.string()),
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
    errorCode?: SubscriptionDetailsErrorCode;
  }> => {
    await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internalApi.users.internal.getCurrentUser);

    const subscription = await ctx.runQuery(
      internalApi.subscriptions.internal.getSubscriptionByUser,
      {
        userId: user._id,
      },
    );

    if (!subscription || !subscription.stripeSubscriptionId) {
      return { status: "error", errorCode: "BILLING_NO_SUBSCRIPTION_LINKED" };
    }

    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId, {
        expand: ["default_payment_method", "schedule"],
      });

      const sub = stripeSub as any;

      if (!sub.items?.data?.[0]?.price) {
        return { status: "error", errorCode: "BILLING_SUBSCRIPTION_PRICE_MISSING" };
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
      return { status: "error", errorCode: mapSubscriptionDetailsErrorCode(error) };
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
    prorationDate: v.optional(v.number()),
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
    creditsGranted: v.optional(v.number()),
  }),
  handler: async (ctx, args): Promise<{
    success: boolean;
    mode: "updated" | "scheduled";
    changeType: ChangeType;
    message: string;
    effectiveDate?: number;
    creditsGranted?: number;
  }> => {
    await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internalApi.users.internal.getCurrentUser);

    if (!isAllowedPriceId(args.targetPriceId)) {
      throw createError("BILLING_INVALID_PRICE_ID", "Invalid target price ID");
    }

    const targetPlan = getPlanFromPriceId(args.targetPriceId);
    if (targetPlan === "free") {
      throw createError(
        "BILLING_CANCEL_TO_FREE_REQUIRES_PORTAL",
        "Use billing portal to cancel to free plan",
      );
    }

    try {
      const subscription = await ctx.runQuery(
        internalApi.subscriptions.internal.getSubscriptionByUser,
        {
          userId: user._id,
        },
      );

      if (!subscription || !subscription.stripeSubscriptionId) {
        throw createError("BILLING_NO_ACTIVE_SUBSCRIPTION", "No active Stripe subscription found");
      }

      const stripeSubscription: any = await stripe.subscriptions.retrieve(
        subscription.stripeSubscriptionId,
        {
          expand: ["schedule"],
        },
      );

      const item = stripeSubscription.items.data[0];
      if (!item?.id || !item.price?.id) {
        throw createError(
          "BILLING_SUBSCRIPTION_ITEM_NOT_FOUND",
          "Current subscription item not found",
        );
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

          // Verify schedule is detached (SUB-05)
          const verifiedSub = await stripe.subscriptions.retrieve(stripeSubscription.id);
          if (verifiedSub.schedule !== null) {
            console.error("[ScheduleLeak] schedule still attached after release", {
              subscriptionId: stripeSubscription.id,
              scheduleId: schedule.id,
              scheduleStillAttached: verifiedSub.schedule,
            });
            throw createError(
              "BILLING_PLAN_CHANGE_CONFLICT",
              "Failed to release pending schedule. Please try again.",
            );
          }
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

          // Verify schedule is detached (SUB-05)
          const verifiedSub = await stripe.subscriptions.retrieve(stripeSubscription.id);
          if (verifiedSub.schedule !== null) {
            console.error("[ScheduleLeak] schedule still attached after release", {
              subscriptionId: stripeSubscription.id,
              scheduleId: schedule.id,
              scheduleStillAttached: verifiedSub.schedule,
            });
            throw createError(
              "BILLING_PLAN_CHANGE_CONFLICT",
              "Failed to release pending schedule. Please try again.",
            );
          }
        }

        const updated = await stripe.subscriptions.update(stripeSubscription.id, {
          items: [
            {
              id: item.id,
              price: args.targetPriceId,
              quantity: item.quantity ?? 1,
            },
          ],
          proration_behavior: "always_invoice",
          proration_date: args.prorationDate,
          payment_behavior: "error_if_incomplete",
          cancel_at_period_end: false,
          metadata: clearPendingPlanMetadata(stripeSubscription.metadata || {}),
        });

        await syncLocalSubscriptionFromStripe(ctx, updated);

        // Grant pro-rata credits for the upgrade
        let creditsGranted: number | undefined;
        const periodStartMs = (stripeSubscription.current_period_start ?? item.current_period_start ?? Math.floor(Date.now() / 1000)) * 1000;
        const periodEndMs = (stripeSubscription.current_period_end ?? item.current_period_end ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60) * 1000;

        try {
          const grantResult = await ctx.runMutation(
            internalApi.credits.internal.grantUpgradeProRataCredits,
            {
              userId: user._id,
              fromPlan: currentPlan,
              toPlan: targetPlan,
              currentPeriodStartMs: periodStartMs,
              currentPeriodEndMs: periodEndMs,
              stripeSubscriptionId: stripeSubscription.id,
            },
          );
          console.log("[changePlan] Pro-rata credit grant result", {
            userId: user._id,
            fromPlan: currentPlan,
            toPlan: targetPlan,
            periodStartMs,
            periodEndMs,
            outcome: grantResult.outcome,
            grantedCredits: grantResult.grantedCredits,
            message: grantResult.message,
          });
          creditsGranted = grantResult.grantedCredits;
        } catch (err) {
          // Plan change already succeeded — don't roll it back for a credit grant failure
          const errorMessage = err instanceof Error ? err.message : String(err);
          console.error("[changePlan] Pro-rata credit grant failed (non-fatal)", {
            userId: user._id,
            fromPlan: currentPlan,
            toPlan: targetPlan,
            periodStartMs,
            periodEndMs,
            error: errorMessage,
          });
        }

        return {
          success: true,
          mode: "updated",
          changeType,
          message: `Plan upgraded to ${targetPlan}. Proration charged immediately.`,
          creditsGranted,
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
        throw createError(
          "BILLING_PERIOD_END_UNAVAILABLE",
          "Unable to determine current period end for downgrade",
        );
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
      if (error instanceof Stripe.errors.StripeCardError) {
        console.warn("[changePlan] Card declined during upgrade", {
          requestId: error.requestId,
          code: error.code,
          declineCode: (error as any).decline_code,
          targetPriceId: args.targetPriceId,
          userId: user._id,
        });
        throw createError(
          "BILLING_CHARGE_FAILED",
          "Upgrade failed — your card was declined. Please update your payment method and try again.",
        );
      }
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        console.error("[changePlan] Stripe invalid request", {
          requestId: error.requestId,
          code: error.code,
          param: error.param,
          message: error.message,
          targetPriceId: args.targetPriceId,
          userId: user._id,
        });
        throw createError(
          "BILLING_PLAN_CHANGE_CONFLICT",
          "Unable to update your plan due to a Stripe billing conflict. Please retry or use the billing portal.",
        );
      }
      throw error;
    }
  },
});

/**
 * Preview the proration amount for an upgrade before the user confirms.
 * Uses Stripe's createPreview API (replacement for deprecated retrieveUpcoming).
 */
export const getUpgradePreview = action({
  args: {
    targetPriceId: v.string(),
  },
  returns: v.object({
    prorationAmountCents: v.number(),
    currency: v.string(),
    immediateChargeCents: v.number(),
    currentPlan: planValidator,
    targetPlan: planValidator,
    proRataCredits: v.number(),
    currentPlanCreditsPerMonth: v.number(),
    targetPlanCreditsPerMonth: v.number(),
    remainingDays: v.number(),
    prorationDate: v.number(),
  }),
  handler: async (ctx, args) => {
    requireSubscriptionsEnabled();
    await requireActionAuth(ctx);
    const user: any = await ctx.runQuery(internalApi.users.internal.getCurrentUser);

    if (!isAllowedPriceId(args.targetPriceId)) {
      throw createError("BILLING_INVALID_PRICE_ID", "Invalid target price ID");
    }

    const targetPlan = getPlanFromPriceId(args.targetPriceId);

    const subscription = await ctx.runQuery(
      internalApi.subscriptions.internal.getSubscriptionByUser,
      { userId: user._id },
    );

    if (!subscription || !subscription.stripeSubscriptionId) {
      throw createError("BILLING_NO_ACTIVE_SUBSCRIPTION", "No active Stripe subscription found");
    }

    const stripeSub = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId,
    );

    const item = stripeSub.items.data[0];
    if (!item?.id || !item.price?.id) {
      throw createError(
        "BILLING_SUBSCRIPTION_ITEM_NOT_FOUND",
        "Current subscription item not found",
      );
    }

    const currentPlan = getPlanFromPriceId(item.price.id);

    const prorationDate = Math.floor(Date.now() / 1000);

    const preview = await stripe.invoices.createPreview({
      customer: typeof stripeSub.customer === "string"
        ? stripeSub.customer
        : (stripeSub.customer as any).id,
      subscription: stripeSub.id,
      subscription_details: {
        items: [{ id: item.id, price: args.targetPriceId }],
        proration_behavior: "always_invoice",
        proration_date: prorationDate,
      },
    });

    // Calculate pro-rata credit info
    const nowMs = Date.now();
    const sub = stripeSub as any;
    const periodStartMs = (sub.current_period_start ?? item.current_period_start ?? Math.floor(nowMs / 1000)) * 1000;
    const periodEndMs = (sub.current_period_end ?? item.current_period_end ?? Math.floor(nowMs / 1000) + 30 * 24 * 60 * 60) * 1000;
    const periodLength = periodEndMs - periodStartMs;
    const remaining = Math.max(0, periodEndMs - nowMs);
    const remainingRatio = periodLength > 0 ? remaining / periodLength : 0;
    const currentPlanCreditsPerMonth = PLAN_CONFIG[currentPlan]?.creditsPerMonth ?? 0;
    const targetPlanCreditsPerMonth = PLAN_CONFIG[targetPlan]?.creditsPerMonth ?? 0;
    const creditDelta = targetPlanCreditsPerMonth - currentPlanCreditsPerMonth;
    const proRataCredits = creditDelta > 0 ? Math.floor(remainingRatio * creditDelta) : 0;
    const remainingDays = Math.ceil(remaining / (24 * 60 * 60 * 1000));

    return {
      prorationAmountCents: preview.total,
      currency: preview.currency,
      immediateChargeCents: preview.amount_due,
      currentPlan,
      targetPlan,
      proRataCredits,
      currentPlanCreditsPerMonth,
      targetPlanCreditsPerMonth,
      remainingDays,
      prorationDate,
    };
  },
});
