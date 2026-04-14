"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import Stripe from "stripe";
import { normalizeStripeSubscriptionStatus } from "../subscriptions/lib/stripeStatus";
import { isSubscriptionScheduledToCancel } from "../subscriptions/lib/cancellation";
import { assertPlanPriceConfig, getPlanFromPriceId } from "../lib/constants";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Stripe operations are unavailable.",
      );
    }
    _stripe = new Stripe(key, { apiVersion: "2026-02-25.clover" });
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
  args: {
    startIndex: v.optional(v.number()),
    startedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const CIRCUIT_BREAKER_MS = 45_000;
    const BATCH_SIZE = 50;

    assertPlanPriceConfig();

    const batchStartedAt = args.startedAt ?? Date.now();
    const resumeIndex = args.startIndex ?? 0;

    // Step 1: Expire past-due subscriptions only on first invocation
    if (resumeIndex === 0) {
      await ctx.runMutation(internal.maintenance.mutations.expirePastDueSubscriptions);
    }

    // Step 2: Fetch all active subscriptions with a stripeSubscriptionId
    const activeSubs = await ctx.runQuery(
      internal.subscriptions.internal.listActiveSubscriptions,
    );

    // Slice to the batch we need to process
    const remaining = activeSubs.slice(resumeIndex);

    // Step 3: Process subs in batches, checking circuit-breaker between each
    let processed = 0;
    for (const sub of remaining) {
      // Circuit-breaker: if we've exceeded our time budget, schedule continuation
      if (Date.now() - batchStartedAt > CIRCUIT_BREAKER_MS) {
        const nextIndex = resumeIndex + processed;
        console.log(`[checkSubscriptionStatus] Circuit-breaker at ${CIRCUIT_BREAKER_MS}ms, scheduling continuation from index ${nextIndex}/${activeSubs.length}`);
        await ctx.scheduler.runAfter(
          0,
          internal.maintenance.internal.checkSubscriptionStatus,
          { startIndex: nextIndex, startedAt: Date.now() },
        );
        return null;
      }

      try {
        const fresh = await getStripe().subscriptions.retrieve(sub.stripeSubscriptionId);
        const item = fresh.items.data[0];

        if (!item?.price?.id) {
          console.warn(`[checkSubscriptionStatus] Subscription ${sub.stripeSubscriptionId} has no price item, skipping`);
          processed++;
          continue;
        }

        // Compute expected local values from Stripe source of truth
        const freshStatus = normalizeStripeSubscriptionStatus(fresh.status);

        const nowSec = Math.floor(Date.now() / 1000);
        const currentPeriodEndSec =
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
          processed++;
          continue;
        }

        // Correct divergence by syncing from Stripe
        const stripeCustomerId =
          typeof fresh.customer === "string"
            ? fresh.customer
            : fresh.customer?.id;

        if (!stripeCustomerId) {
          console.warn(`[checkSubscriptionStatus] No customer ID for subscription ${sub.stripeSubscriptionId}, skipping correction`);
          processed++;
          continue;
        }

        const currentPeriodStartSec =
          item.current_period_start ?? nowSec;

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
            metadata: fresh.metadata ?? {},
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
      processed++;
    }

    if (processed > 0) {
      console.log(`[checkSubscriptionStatus] Completed batch: processed ${processed} subs (index ${resumeIndex}-${resumeIndex + processed}/${activeSubs.length})`);
    }

    return null;
  },
});
