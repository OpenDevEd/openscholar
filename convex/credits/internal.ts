import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { FREE_CREDIT_CAP } from "../lib/constants";
import { ConvexError } from "convex/values";
import { internal, components } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { selectCanonicalSubscription } from "../subscriptions/lib/selectCanonicalSubscription";
import {
  getCreditGrantRetryDelayMs,
  shouldRetryCreditGrant,
} from "./lib/retryPolicy";
import {
  classifyMonthlyCreditInvoice,
  type MonthlyCreditGrantDecision,
} from "./lib/invoiceGrantPolicy";
import { requireCreditsEnabled } from "../lib/featureFlags";

const internalApi = internal as any;
const componentApi = components as any;

type GrantMutationOutcome =
  | "granted"
  | "already_granted"
  | "ignored_non_recurring"
  | "failed_config_drift"
  | "retrying_reconcile"
  | "retrying_subscription_lookup"
  | "failed_subscription_lookup"
  | "processed_no_credits";

type GrantMutationResult = {
  outcome: GrantMutationOutcome;
  decision: MonthlyCreditGrantDecision;
  classification: string;
  grantedCredits: number;
  message: string;
};

function createGrantResult(args: {
  outcome: GrantMutationOutcome;
  decision: MonthlyCreditGrantDecision;
  classification: string;
  grantedCredits?: number;
  message: string;
}): GrantMutationResult {
  return {
    outcome: args.outcome,
    decision: args.decision,
    classification: args.classification,
    grantedCredits: args.grantedCredits ?? 0,
    message: args.message,
  };
}

/**
 * Get credit balance for a user by ID (for background jobs)
 */
export const getBalanceByUserId = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(
    v.null(),
    v.object({
      free: v.number(),
      paid: v.number(),
      total: v.number(),
      lifetimeUsed: v.number(),
    }),
  ),
  handler: async (ctx, { userId }) => {
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId).eq("ownerType", "user"))
      .unique();

    if (!credits) return null;

    return {
      free: credits.freeBalance,
      paid: credits.paidBalance,
      total: credits.freeBalance + credits.paidBalance,
      lifetimeUsed: credits.lifetimeUsed,
    };
  },
});

async function getLatestCreditsByOwner(
  ctx: MutationCtx,
  args: {
    ownerId: string;
    ownerType: "user" | "organization";
  },
): Promise<Doc<"credits"> | null> {
  const rows = await ctx.db
    .query("credits")
    .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId).eq("ownerType", args.ownerType))
    .order("desc")
    .collect();
  return rows[0] ?? null;
}

export function buildInitialCreditsRecord(args: {
  ownerId: string;
  ownerType: "user" | "organization";
  now: number;
}) {
  return {
    ownerId: args.ownerId,
    ownerType: args.ownerType,
    freeBalance: 0,
    paidBalance: 0,
    lifetimeUsed: 0,
    lastUpdatedAt: args.now,
  };
}

export const ensureCreditsForOwner = internalMutation({
  args: {
    ownerId: v.string(),
    ownerType: v.union(v.literal("user"), v.literal("organization")),
  },
  returns: v.object({
    creditsId: v.id("credits"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const existing = await getLatestCreditsByOwner(ctx, args);
    if (existing) {
      return { creditsId: existing._id, created: false };
    }

    const now = Date.now();
    const creditsId = await ctx.db.insert(
      "credits",
      buildInitialCreditsRecord({
        ownerId: args.ownerId,
        ownerType: args.ownerType,
        now,
      }),
    );

    return { creditsId, created: true };
  },
});

async function findGrantSubscription(
  ctx: MutationCtx,
  args: {
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
  },
) {
  if (args.stripeSubscriptionId) {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId!))
      .order("desc")
      .collect();
    const canonical = selectCanonicalSubscription(subs);
    if (canonical) return canonical;
  }

  if (args.stripeCustomerId) {
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", args.stripeCustomerId!))
      .order("desc")
      .collect();
    const canonical = selectCanonicalSubscription(subs);
    if (canonical) return canonical;
  }

  return null;
}

async function markEventRetrying(
  ctx: MutationCtx,
  args: {
    stripeEventId?: string;
    eventType?: string;
    stripeObjectId?: string;
    stripeApiVersion?: string;
    classification?: string;
    reason: string;
    retryAt: number;
  },
): Promise<void> {
  if (!args.stripeEventId) return;
  await ctx.runMutation(internalApi.subscriptions.internal.markStripeEventRetrying, {
    stripeEventId: args.stripeEventId,
    eventType: args.eventType ?? "invoice.paid",
    stripeObjectId: args.stripeObjectId,
    stripeApiVersion: args.stripeApiVersion,
    classification: args.classification,
    retryAt: args.retryAt,
    reason: args.reason,
  });
}

async function markEventFailed(
  ctx: MutationCtx,
  args: {
    stripeEventId?: string;
    eventType?: string;
    stripeObjectId?: string;
    stripeApiVersion?: string;
    classification?: string;
    message: string;
  },
): Promise<void> {
  if (!args.stripeEventId) return;
  await ctx.runMutation(internalApi.subscriptions.internal.markStripeEventFailed, {
    stripeEventId: args.stripeEventId,
    eventType: args.eventType ?? "invoice.paid",
    stripeObjectId: args.stripeObjectId,
    stripeApiVersion: args.stripeApiVersion,
    classification: args.classification,
    errorMessage: args.message,
  });
}

async function markEventProcessed(
  ctx: MutationCtx,
  args: {
    stripeEventId?: string;
    eventType?: string;
    stripeObjectId?: string;
    stripeApiVersion?: string;
    classification?: string;
  },
): Promise<void> {
  if (!args.stripeEventId) return;
  await ctx.runMutation(internalApi.subscriptions.internal.markStripeEventProcessed, {
    stripeEventId: args.stripeEventId,
    eventType: args.eventType ?? "invoice.paid",
    stripeObjectId: args.stripeObjectId,
    stripeApiVersion: args.stripeApiVersion,
    classification: args.classification,
  });
}

async function markEventIgnored(
  ctx: MutationCtx,
  args: {
    stripeEventId?: string;
    eventType?: string;
    stripeObjectId?: string;
    stripeApiVersion?: string;
    classification?: string;
    message: string;
  },
): Promise<void> {
  if (!args.stripeEventId) return;
  await ctx.runMutation(internalApi.subscriptions.internal.markStripeEventIgnored, {
    stripeEventId: args.stripeEventId,
    eventType: args.eventType ?? "invoice.paid",
    stripeObjectId: args.stripeObjectId,
    stripeApiVersion: args.stripeApiVersion,
    classification: args.classification,
    reason: args.message,
  });
}

/**
 * Queue reconciliation from invoice.created/finalized so we can recover if
 * invoice.paid arrives late or gets dropped.
 */
export const enqueueInvoiceCreditReconciliation = internalMutation({
  args: {
    stripeInvoiceId: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeEventId: v.optional(v.string()),
    stripeEventType: v.optional(v.string()),
    invoiceStatus: v.optional(v.string()),
    invoiceBillingReason: v.optional(v.string()),
    stripeApiVersion: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("creditTransactions")
      .withIndex("by_stripe_invoice", (q) => q.eq("stripeInvoiceId", args.stripeInvoiceId))
      .unique();

    if (existing) return null;

    if (!args.stripeCustomerId && !args.stripeSubscriptionId) {
      return null;
    }

    const delayMs = args.invoiceStatus === "paid" ? 5_000 : 60_000;

    await ctx.scheduler.runAfter(delayMs, internalApi.credits.internal.reconcileInvoiceCreditGrant, {
      stripeInvoiceId: args.stripeInvoiceId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeCustomerId: args.stripeCustomerId,
      stripeEventId: args.stripeEventId,
      stripeEventType: args.stripeEventType,
      invoiceStatus: args.invoiceStatus,
      invoiceBillingReason: args.invoiceBillingReason,
      stripeApiVersion: args.stripeApiVersion,
      retryCount: 0,
    });

    return null;
  },
});

/**
 * Reconcile invoice grant state using the Stripe component invoice mirror.
 */
export const reconcileInvoiceCreditGrant = internalMutation({
  args: {
    stripeInvoiceId: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeEventId: v.optional(v.string()),
    stripeEventType: v.optional(v.string()),
    invoiceStatus: v.optional(v.string()),
    invoiceBillingReason: v.optional(v.string()),
    stripeApiVersion: v.optional(v.string()),
    retryCount: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const retryCount = args.retryCount ?? 0;

    const existing = await ctx.db
      .query("creditTransactions")
      .withIndex("by_stripe_invoice", (q) => q.eq("stripeInvoiceId", args.stripeInvoiceId))
      .unique();

    if (existing) {
      await markEventProcessed(ctx, {
        stripeEventId: args.stripeEventId,
        eventType: args.stripeEventType,
        stripeObjectId: args.stripeInvoiceId,
        stripeApiVersion: args.stripeApiVersion,
        classification: "already_granted",
      });
      return null;
    }

    if (!args.stripeCustomerId && !args.stripeSubscriptionId) {
      return null;
    }

    let invoiceStatus: string | undefined = args.invoiceStatus;
    let stripeSubscriptionId = args.stripeSubscriptionId;
    let amountPaid: number | undefined;

    if (args.stripeCustomerId) {
      const invoices: Array<{
        stripeInvoiceId: string;
        stripeSubscriptionId?: string;
        status: string;
        amountPaid: number;
      }> = await ctx.runQuery(componentApi.stripe.public.listInvoices, {
        stripeCustomerId: args.stripeCustomerId,
      });
      const invoice = invoices.find((row) => row.stripeInvoiceId === args.stripeInvoiceId);

      if (invoice) {
        invoiceStatus = invoice.status;
        stripeSubscriptionId = stripeSubscriptionId ?? invoice.stripeSubscriptionId;
        amountPaid = invoice.amountPaid;
      }
    }

    if (invoiceStatus === "paid") {
      await ctx.runMutation(internalApi.credits.internal.grantMonthlyCredits, {
        stripeSubscriptionId,
        stripeCustomerId: args.stripeCustomerId,
        stripeInvoiceId: args.stripeInvoiceId,
        amountPaid,
        invoiceStatus,
        stripeEventId: args.stripeEventId,
        stripeEventType: args.stripeEventType,
        invoiceBillingReason: args.invoiceBillingReason,
        stripeApiVersion: args.stripeApiVersion,
        retryCount: 0,
      });
      return null;
    }

    if (!shouldRetryCreditGrant(retryCount)) {
      await ctx.runMutation(internalApi.subscriptions.internal.markStripeEventIgnored, {
        stripeEventId: args.stripeEventId ?? args.stripeInvoiceId,
        eventType: "invoice.reconcile",
        stripeObjectId: args.stripeInvoiceId,
        stripeApiVersion: args.stripeApiVersion,
        classification: "retry_exhausted_not_paid",
        reason: `Invoice ${args.stripeInvoiceId} never reached paid status during reconciliation`,
      });
      return null;
    }

    const retryDelayMs = getCreditGrantRetryDelayMs(retryCount);
    if (retryDelayMs === null) return null;

    const retryAt = Date.now() + retryDelayMs;
    await markEventRetrying(ctx, {
      stripeEventId: args.stripeEventId,
      eventType: args.stripeEventType ?? "invoice.reconcile",
      stripeObjectId: args.stripeInvoiceId,
      stripeApiVersion: args.stripeApiVersion,
      classification: "retry_invoice_not_paid",
      reason: `Invoice ${args.stripeInvoiceId} not paid yet (status=${invoiceStatus ?? "unknown"})`,
      retryAt,
    });

    await ctx.scheduler.runAfter(retryDelayMs, internalApi.credits.internal.reconcileInvoiceCreditGrant, {
      ...args,
      retryCount: retryCount + 1,
    });

    return null;
  },
});

/**
 * Grant monthly credits for subscription.
 * Free credits are capped at FREE_CREDIT_CAP.
 */
export const grantMonthlyCredits = internalMutation({
  args: {
    stripeSubscriptionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    stripeInvoiceId: v.optional(v.string()),
    amountPaid: v.optional(v.number()),
    invoiceStatus: v.optional(v.string()),
    invoiceBillingReason: v.optional(v.string()),
    stripeApiVersion: v.optional(v.string()),
    stripeEventId: v.optional(v.string()),
    stripeEventType: v.optional(v.string()),
    retryCount: v.optional(v.number()),
  },
  returns: v.object({
    outcome: v.union(
      v.literal("granted"),
      v.literal("already_granted"),
      v.literal("ignored_non_recurring"),
      v.literal("failed_config_drift"),
      v.literal("retrying_reconcile"),
      v.literal("retrying_subscription_lookup"),
      v.literal("failed_subscription_lookup"),
      v.literal("processed_no_credits"),
    ),
    decision: v.union(
      v.literal("grant"),
      v.literal("ignore_non_recurring"),
      v.literal("ignore_config_drift"),
      v.literal("retry_with_reconcile"),
    ),
    classification: v.string(),
    grantedCredits: v.number(),
    message: v.string(),
  }),
  handler: async (ctx, args): Promise<GrantMutationResult> => {
    const retryCount = args.retryCount ?? 0;

    if (args.stripeInvoiceId) {
      const existing = await ctx.db
        .query("creditTransactions")
        .withIndex("by_stripe_invoice", (q) => q.eq("stripeInvoiceId", args.stripeInvoiceId))
        .unique();

      if (existing) {
        await markEventProcessed(ctx, {
          stripeEventId: args.stripeEventId,
          eventType: args.stripeEventType,
          stripeObjectId: args.stripeInvoiceId,
          stripeApiVersion: args.stripeApiVersion,
          classification: "already_granted",
        });
        return createGrantResult({
          outcome: "already_granted",
          decision: "grant",
          classification: "already_granted",
          message: `Invoice ${args.stripeInvoiceId} already granted`,
        });
      }
    }

    const decision = classifyMonthlyCreditInvoice({
      invoiceBillingReason: args.invoiceBillingReason,
      invoiceStatus: args.invoiceStatus ?? "paid",
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeApiVersion: args.stripeApiVersion,
    });

    if (decision.decision === "retry_with_reconcile") {
      if (!args.stripeInvoiceId) {
        await markEventFailed(ctx, {
          stripeEventId: args.stripeEventId,
          eventType: args.stripeEventType,
          stripeObjectId: args.stripeInvoiceId,
          stripeApiVersion: args.stripeApiVersion,
          classification: "retry_missing_invoice_id",
          message: "Cannot reconcile invoice without stripeInvoiceId",
        });
        return createGrantResult({
          outcome: "failed_config_drift",
          decision: decision.decision,
          classification: "retry_missing_invoice_id",
          message: "Cannot reconcile invoice without stripeInvoiceId",
        });
      }

      if (!shouldRetryCreditGrant(retryCount)) {
        await markEventFailed(ctx, {
          stripeEventId: args.stripeEventId,
          eventType: args.stripeEventType,
          stripeObjectId: args.stripeInvoiceId,
          stripeApiVersion: args.stripeApiVersion,
          classification: decision.classification,
          message: `Retry budget exhausted for invoice ${args.stripeInvoiceId ?? "unknown"}: ${decision.reason}`,
        });
        return createGrantResult({
          outcome: "failed_config_drift",
          decision: decision.decision,
          classification: decision.classification,
          message: decision.reason,
        });
      }

      const retryDelayMs = getCreditGrantRetryDelayMs(retryCount);
      if (retryDelayMs === null) {
        return createGrantResult({
          outcome: "retrying_reconcile",
          decision: decision.decision,
          classification: decision.classification,
          message: decision.reason,
        });
      }

      const retryAt = Date.now() + retryDelayMs;
      await markEventRetrying(ctx, {
        stripeEventId: args.stripeEventId,
        eventType: args.stripeEventType ?? "invoice.paid",
        stripeObjectId: args.stripeInvoiceId,
        stripeApiVersion: args.stripeApiVersion,
        classification: decision.classification,
        reason: decision.reason,
        retryAt,
      });

      await ctx.scheduler.runAfter(retryDelayMs, internalApi.credits.internal.reconcileInvoiceCreditGrant, {
        stripeInvoiceId: args.stripeInvoiceId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        stripeCustomerId: args.stripeCustomerId,
        stripeEventId: args.stripeEventId,
        stripeEventType: args.stripeEventType,
        invoiceStatus: args.invoiceStatus,
        invoiceBillingReason: args.invoiceBillingReason,
        stripeApiVersion: args.stripeApiVersion,
        retryCount: retryCount + 1,
      });

      return createGrantResult({
        outcome: "retrying_reconcile",
        decision: decision.decision,
        classification: decision.classification,
        message: decision.reason,
      });
    }

    if (decision.decision === "ignore_non_recurring") {
      await markEventIgnored(ctx, {
        stripeEventId: args.stripeEventId,
        eventType: args.stripeEventType,
        stripeObjectId: args.stripeInvoiceId,
        stripeApiVersion: args.stripeApiVersion,
        classification: decision.classification,
        message: decision.reason,
      });
      return createGrantResult({
        outcome: "ignored_non_recurring",
        decision: decision.decision,
        classification: decision.classification,
        message: decision.reason,
      });
    }

    if (decision.decision === "ignore_config_drift") {
      await markEventFailed(ctx, {
        stripeEventId: args.stripeEventId,
        eventType: args.stripeEventType,
        stripeObjectId: args.stripeInvoiceId,
        stripeApiVersion: args.stripeApiVersion,
        classification: decision.classification,
        message: `${decision.reason}. Verify Stripe webhook endpoint API version and enabled invoice events.`,
      });
      return createGrantResult({
        outcome: "failed_config_drift",
        decision: decision.decision,
        classification: decision.classification,
        message: decision.reason,
      });
    }

    const subscription = await findGrantSubscription(ctx, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeCustomerId: args.stripeCustomerId,
    });

    if (!subscription) {
      if (shouldRetryCreditGrant(retryCount)) {
        const retryDelayMs = getCreditGrantRetryDelayMs(retryCount);
        if (retryDelayMs !== null) {
          const retryAt = Date.now() + retryDelayMs;
          await markEventRetrying(ctx, {
            stripeEventId: args.stripeEventId,
            eventType: args.stripeEventType,
            stripeObjectId: args.stripeInvoiceId,
            stripeApiVersion: args.stripeApiVersion,
            classification: "retry_subscription_lookup",
            reason: `Subscription not found for invoice ${args.stripeInvoiceId ?? "unknown"}`,
            retryAt,
          });

          await ctx.scheduler.runAfter(retryDelayMs, internalApi.credits.internal.grantMonthlyCredits, {
            ...args,
            retryCount: retryCount + 1,
          });
        }
        return createGrantResult({
          outcome: "retrying_subscription_lookup",
          decision: "grant",
          classification: "retry_subscription_lookup",
          message: `Subscription not found for invoice ${args.stripeInvoiceId ?? "unknown"}, retry scheduled`,
        });
      }

      await markEventFailed(ctx, {
        stripeEventId: args.stripeEventId,
        eventType: args.stripeEventType,
        stripeObjectId: args.stripeInvoiceId,
        stripeApiVersion: args.stripeApiVersion,
        classification: "subscription_lookup_failed",
        message: `Subscription lookup failed after retries for invoice ${args.stripeInvoiceId ?? "unknown"}`,
      });
      return createGrantResult({
        outcome: "failed_subscription_lookup",
        decision: "grant",
        classification: "subscription_lookup_failed",
        message: `Subscription lookup failed for invoice ${args.stripeInvoiceId ?? "unknown"}`,
      });
    }

    if (!subscription.creditsPerMonth || subscription.plan === "free") {
      await markEventProcessed(ctx, {
        stripeEventId: args.stripeEventId,
        eventType: args.stripeEventType,
        stripeObjectId: args.stripeInvoiceId,
        stripeApiVersion: args.stripeApiVersion,
        classification: "no_entitled_credits",
      });
      return createGrantResult({
        outcome: "processed_no_credits",
        decision: "grant",
        classification: "no_entitled_credits",
        message: `Subscription ${subscription._id} has no monthly credits to grant`,
      });
    }

    let credits: Doc<"credits"> | null = await getLatestCreditsByOwner(ctx, {
      ownerId: subscription.ownerId,
      ownerType: subscription.ownerType,
    });
    if (!credits) {
      const now = Date.now();
      const creditsId = await ctx.db.insert(
        "credits",
        buildInitialCreditsRecord({
          ownerId: subscription.ownerId,
          ownerType: subscription.ownerType,
          now,
        }),
      );
      credits = await ctx.db.get(creditsId);
    }

    if (!credits) {
      await markEventFailed(ctx, {
        stripeEventId: args.stripeEventId,
        eventType: args.stripeEventType,
        stripeObjectId: args.stripeInvoiceId,
        stripeApiVersion: args.stripeApiVersion,
        classification: "credits_record_missing",
        message: `Unable to create credits record for owner ${subscription.ownerId}`,
      });
      return createGrantResult({
        outcome: "failed_subscription_lookup",
        decision: "grant",
        classification: "credits_record_missing",
        message: `Unable to create credits record for owner ${subscription.ownerId}`,
      });
    }

    const now = Date.now();
    const currentFree = credits.freeBalance;
    const creditsToGrant = subscription.creditsPerMonth;
    const newFreeBalance = Math.min(currentFree + creditsToGrant, FREE_CREDIT_CAP);
    const actualGranted = newFreeBalance - currentFree;

    if (actualGranted <= 0) {
      await markEventProcessed(ctx, {
        stripeEventId: args.stripeEventId,
        eventType: args.stripeEventType,
        stripeObjectId: args.stripeInvoiceId,
        stripeApiVersion: args.stripeApiVersion,
        classification: "cap_reached_or_zero_grant",
      });
      return createGrantResult({
        outcome: "processed_no_credits",
        decision: "grant",
        classification: "cap_reached_or_zero_grant",
        message: `No grant applied for invoice ${args.stripeInvoiceId ?? "unknown"} due to cap or zero delta`,
      });
    }

    await ctx.db.patch(credits._id, {
      freeBalance: newFreeBalance,
      lastUpdatedAt: now,
    });

    await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      type: "grant",
      creditType: "free",
      amount: actualGranted,
      balanceAfter: newFreeBalance,
      description: `Monthly credit grant (${subscription.plan} plan) - ${actualGranted}/${creditsToGrant} credits granted`,
      stripeInvoiceId: args.stripeInvoiceId,
      createdAt: now,
    });

    await markEventProcessed(ctx, {
      stripeEventId: args.stripeEventId,
      eventType: args.stripeEventType,
      stripeObjectId: args.stripeInvoiceId,
      stripeApiVersion: args.stripeApiVersion,
      classification: "granted",
    });

    return createGrantResult({
      outcome: "granted",
      decision: "grant",
      classification: "granted",
      grantedCredits: actualGranted,
      message: `Granted ${actualGranted} monthly credits for invoice ${args.stripeInvoiceId ?? "unknown"}`,
    });
  },
});

/**
 * Deduct credits for usage
 * Consumes free credits first, then paid credits
 */
export const deductCredits = internalMutation({
  args: {
    userId: v.id("users"),
    organizationId: v.optional(v.id("organizations")),
    amount: v.number(),
    description: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    requireCreditsEnabled();
    const ownerId = args.organizationId ?? args.userId;
    const ownerType = args.organizationId ? "organization" : "user";

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId).eq("ownerType", ownerType))
      .unique();

    if (!credits) throw new ConvexError({ code: "NOT_FOUND", message: "Credits record not found" });

    const totalAvailable = credits.freeBalance + credits.paidBalance;
    if (totalAvailable < args.amount) {
      throw new ConvexError({
        code: "INSUFFICIENT_CREDITS",
        message: `Insufficient credits: need ${args.amount}, have ${totalAvailable}`,
      });
    }

    const now = Date.now();
    let amountToDeduct = args.amount;
    let newFreeBalance = credits.freeBalance;
    let newPaidBalance = credits.paidBalance;

    if (newFreeBalance >= amountToDeduct) {
      newFreeBalance -= amountToDeduct;

      await ctx.db.insert("creditTransactions", {
        creditsId: credits._id,
        userId: args.userId,
        type: "usage",
        creditType: "free",
        amount: -amountToDeduct,
        balanceAfter: newFreeBalance,
        description: args.description,
        metadata: args.metadata,
        createdAt: now,
      });
    } else {
      const freeUsed = newFreeBalance;
      newFreeBalance = 0;

      if (freeUsed > 0) {
        await ctx.db.insert("creditTransactions", {
          creditsId: credits._id,
          userId: args.userId,
          type: "usage",
          creditType: "free",
          amount: -freeUsed,
          balanceAfter: 0,
          description: args.description,
          metadata: args.metadata,
          createdAt: now,
        });
      }

      const paidNeeded = amountToDeduct - freeUsed;
      newPaidBalance -= paidNeeded;

      await ctx.db.insert("creditTransactions", {
        creditsId: credits._id,
        userId: args.userId,
        type: "usage",
        creditType: "paid",
        amount: -paidNeeded,
        balanceAfter: newPaidBalance,
        description: args.description,
        metadata: args.metadata,
        createdAt: now,
      });
    }

    await ctx.db.patch(credits._id, {
      freeBalance: newFreeBalance,
      paidBalance: newPaidBalance,
      lifetimeUsed: credits.lifetimeUsed + args.amount,
      lastUpdatedAt: now,
    });

    return totalAvailable - args.amount;
  },
});

/**
 * Add credits (admin grant or refund)
 */
export const addCredits = internalMutation({
  args: {
    ownerId: v.string(),
    ownerType: v.union(v.literal("user"), v.literal("organization")),
    amount: v.number(),
    type: v.union(v.literal("grant"), v.literal("refund")),
    creditType: v.union(v.literal("free"), v.literal("paid")),
    description: v.optional(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId).eq("ownerType", args.ownerType))
      .unique();

    if (!credits) throw new ConvexError({ code: "NOT_FOUND", message: "Credits record not found" });

    const now = Date.now();
    let newFreeBalance = credits.freeBalance;
    let newPaidBalance = credits.paidBalance;
    let actualAdded = args.amount;

    if (args.creditType === "free") {
      newFreeBalance = Math.min(newFreeBalance + args.amount, FREE_CREDIT_CAP);
      actualAdded = newFreeBalance - credits.freeBalance;
    } else {
      newPaidBalance += args.amount;
    }

    await ctx.db.patch(credits._id, {
      freeBalance: newFreeBalance,
      paidBalance: newPaidBalance,
      lastUpdatedAt: now,
    });

    await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      type: args.type,
      creditType: args.creditType,
      amount: actualAdded,
      balanceAfter: args.creditType === "free" ? newFreeBalance : newPaidBalance,
      description: args.description,
      createdAt: now,
    });

    return args.creditType === "free" ? newFreeBalance : newPaidBalance;
  },
});
