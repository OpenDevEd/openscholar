"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import Stripe from "stripe";
import { normalizeStripeSubscriptionStatus } from "../subscriptions/lib/stripeStatus";
import { isSubscriptionScheduledToCancel } from "../subscriptions/lib/cancellation";
import { getPlanFromPriceId } from "../lib/constants";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Stripe operations are unavailable.",
      );
    }
    _stripe = new Stripe(key, { apiVersion: "2026-01-28.clover" });
  }
  return _stripe;
}

/**
 * Corrective subscription sync cron.
 * 1. Expires past-due subscriptions (grace period logic).
 * 2. Re-fetches each active subscription from Stripe API (source of truth).
 * 3. If local state diverges from Stripe, auto-corrects via syncSubscription.
 *
 * Per locked decision:
 * - Auto-correct divergences silently + log the correction.
 * - Fix subscription state only -- do NOT cascade corrections to credits.
 * - Corrections logged to Convex function logs (no external notifications).
 */
export const checkSubscriptionStatus = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Step 1: Expire past-due subscriptions (DB-only, runs as mutation)
    await ctx.runMutation(internal.maintenance.mutations.expirePastDueSubscriptions);

    // Step 2: Fetch all active subscriptions with a stripeSubscriptionId
    const activeSubs = await ctx.runQuery(
      internal.subscriptions.internal.listActiveSubscriptions,
    );

    // Step 3: For each, re-fetch from Stripe and correct divergences
    for (const sub of activeSubs) {
      try {
        const fresh: any = await getStripe().subscriptions.retrieve(sub.stripeSubscriptionId);
        const item = fresh.items.data[0];

        if (!item?.price?.id) {
          console.warn(`[checkSubscriptionStatus] Subscription ${sub.stripeSubscriptionId} has no price item, skipping`);
          continue;
        }

        // Compute expected local values from Stripe source of truth
        const freshStatus = normalizeStripeSubscriptionStatus(fresh.status);

        const nowSec = Math.floor(Date.now() / 1000);
        const currentPeriodEndSec =
          fresh.current_period_end ??
          item.current_period_end ??
          nowSec + 30 * 24 * 60 * 60;
        const freshPeriodEnd = currentPeriodEndSec * 1000;

        const freshPlan = getPlanFromPriceId(item.price.id);

        const freshCancelAtPeriodEnd = isSubscriptionScheduledToCancel({
          cancelAtPeriodEnd: fresh.cancel_at_period_end ?? false,
          cancelAt: fresh.cancel_at ?? null,
          currentPeriodEnd: currentPeriodEndSec,
          nowUnixSeconds: nowSec,
        });

        // Detect divergence
        const divergedFields: string[] = [];

        if (sub.status !== freshStatus) {
          divergedFields.push("status");
        }
        if (sub.currentPeriodEnd !== freshPeriodEnd) {
          divergedFields.push("currentPeriodEnd");
        }
        if (sub.plan !== freshPlan) {
          divergedFields.push("plan");
        }
        if (sub.cancelAtPeriodEnd !== freshCancelAtPeriodEnd) {
          divergedFields.push("cancelAtPeriodEnd");
        }

        if (divergedFields.length === 0) {
          // No divergence, skip silently
          continue;
        }

        // Correct divergence by syncing from Stripe
        const stripeCustomerId =
          typeof fresh.customer === "string"
            ? fresh.customer
            : (fresh.customer as any)?.id;

        if (!stripeCustomerId) {
          console.warn(`[checkSubscriptionStatus] No customer ID for subscription ${sub.stripeSubscriptionId}, skipping correction`);
          continue;
        }

        const currentPeriodStartSec =
          fresh.current_period_start ?? item.current_period_start ?? nowSec;

        await ctx.runMutation(
          internal.subscriptions.internal.syncSubscription,
          {
            stripeSubscriptionId: fresh.id,
            stripeCustomerId,
            status: freshStatus,
            currentPeriodStart: currentPeriodStartSec * 1000,
            currentPeriodEnd: freshPeriodEnd,
            cancelAtPeriodEnd: freshCancelAtPeriodEnd,
            priceId: item.price.id,
            quantity: item.quantity,
            metadata: (fresh.metadata ?? {}) as Record<string, string>,
          },
        );

        console.log(`[checkSubscriptionStatus] Corrected divergence`, {
          subscriptionId: sub.stripeSubscriptionId,
          divergedFields,
        });
      } catch (error) {
        // Log but don't throw -- continue checking other subscriptions
        console.error(`[checkSubscriptionStatus] Failed to check subscription ${sub.stripeSubscriptionId}`, error);
      }
    }

    return null;
  },
});
