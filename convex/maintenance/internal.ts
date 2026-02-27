"use node";

import { internalAction, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import Stripe from "stripe";
import { normalizeStripeSubscriptionStatus } from "../subscriptions/lib/stripeStatus";
import { isSubscriptionScheduledToCancel } from "../subscriptions/lib/cancellation";
import { getPlanFromPriceId } from "../lib/constants";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "dummy", {
  apiVersion: "2026-01-28.clover",
});

// Retention period for deleted users (30 days)
const DELETED_USER_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Clean up data for users deleted more than 30 days ago
 */
export const cleanupDeletedUsers = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - DELETED_USER_RETENTION_MS;
    const BATCH_SIZE = 50;

    // Find deleted users past retention period
    const deletedUsers = await ctx.db
      .query("users")
      .withIndex("by_state", (q) => q.eq("state", "deleted"))
      .take(BATCH_SIZE);

    let cleanedCount = 0;

    for (const user of deletedUsers) {
      if (user.updatedAt < cutoff) {
        // Clean up user's API keys
        const apiKeys = await ctx.db
          .query("apiKeys")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .collect();

        for (const key of apiKeys) {
          await ctx.db.delete(key._id);
        }

        // Hard delete the user to prevent re-processing
        await ctx.db.delete(user._id);

        // Note: We keep credits and subscriptions for audit purposes

        cleanedCount++;
      }
    }

    // If we fetched a full batch, there might be more to process
    if (deletedUsers.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.maintenance.internal.cleanupDeletedUsers, {});
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} deleted users`);
    }
  },
});

/**
 * Expire past-due subscriptions that have exceeded the 7-day grace period.
 * Auto-downgrades to free plan with canceled status.
 *
 * Extracted from checkSubscriptionStatus so the past-due logic runs as a
 * mutation (OCC-safe DB writes) while the corrective sync runs as an action
 * (needs Stripe API).
 */
export const expirePastDueSubscriptions = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days per locked decision

    // Find past_due subscriptions
    const pastDueSubs = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "past_due"))
      .collect();

    let downgradeCount = 0;

    for (const sub of pastDueSubs) {
      const pastDueSince = sub.pastDueSince ?? sub.updatedAt;
      if (now - pastDueSince > GRACE_PERIOD_MS) {
        // Grace period expired -- downgrade to free plan
        // Per locked decision: automatically downgrade to free plan after grace period
        await ctx.db.patch(sub._id, {
          status: "canceled",
          plan: "free",
          canceledAt: now,
          updatedAt: now,
          creditsPerMonth: 0,
          pastDueSince: undefined,
          // stripeSubscriptionId preserved for audit trail (consistent with SUB-03 fix)
        });
        downgradeCount++;
        console.warn(`[expirePastDueSubscriptions] Grace period expired, downgraded subscription ${sub._id} to free`, {
          userId: sub.userId,
          pastDueSince,
          gracePeriodDays: 7,
        });
      }
    }

    if (downgradeCount > 0) {
      console.log(`[expirePastDueSubscriptions] Downgraded ${downgradeCount} past-due subscriptions after grace period`);
    }

    return null;
  },
});

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
    await ctx.runMutation(internal.maintenance.internal.expirePastDueSubscriptions);

    // Step 2: Fetch all active subscriptions with a stripeSubscriptionId
    const activeSubs = await ctx.runQuery(
      internal.subscriptions.internal.listActiveSubscriptions,
    );

    // Step 3: For each, re-fetch from Stripe and correct divergences
    for (const sub of activeSubs) {
      try {
        const fresh: any = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
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

/**
 * Monitor for stale failed Stripe events.
 * Flags events that have been in "failed" status for >1 hour via console.error
 * for visibility in the Convex dashboard.
 *
 * Per locked decision: flag only, do NOT auto-retry failed events.
 * Manual investigation is safer for events that failed for a reason.
 */
export const monitorFailedStripeEvents = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    // Query using by_status_next_retry index (prefix query on status field)
    const failedEvents = await ctx.db
      .query("stripeEventLogs")
      .withIndex("by_status_next_retry", (q) => q.eq("status", "failed"))
      .collect();

    // Filter in JS for updatedAt threshold (no composite index on status+updatedAt)
    const staleFailures = failedEvents.filter((e) => e.updatedAt < oneHourAgo);

    for (const event of staleFailures) {
      console.error(`[ALERT] Stale failed Stripe event`, {
        stripeEventId: event.stripeEventId,
        eventType: event.eventType,
        lastError: event.lastError,
        failedAt: event.updatedAt,
        ageMinutes: Math.floor((Date.now() - event.updatedAt) / 60_000),
      });
    }

    if (staleFailures.length > 0) {
      console.error(
        `[ALERT] ${staleFailures.length} Stripe event(s) in failed status for >1 hour. Manual investigation required.`,
      );
    }

    return null;
  },
});
