import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internal, components } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { selectCanonicalSubscription } from "../subscriptions/lib/selectCanonicalSubscription";
import { resolveEffectivePlan } from "../../lib/billing/entitlements";
import { applyTierFreeCreditCap } from "../lib/freeCredits";
import {
  getCreditGrantRetryDelayMs,
  shouldRetryCreditGrant,
} from "./lib/retryPolicy";
import {
  classifyMonthlyCreditInvoice,
  type MonthlyCreditGrantDecision,
} from "./lib/invoiceGrantPolicy";
import { requireCreditsEnabled } from "../lib/featureFlags";
import {
  CREDIT_TOPUP_CURRENCY,
  calculateRefundDeltaCredits,
  calculateRefundTargetCredits,
  convertCreditsToAmountCents,
  getCreditsPerUsd,
} from "../lib/creditTopups";

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
      .withIndex("by_user", (q) => q.eq("userId", userId))
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

async function getLatestCreditsByUser(
  ctx: MutationCtx,
  userId: Doc<"users">["_id"],
): Promise<Doc<"credits"> | null> {
  const rows = await ctx.db
    .query("credits")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .collect();
  return rows[0] ?? null;
}

export function buildInitialCreditsRecord(args: {
  userId: Doc<"users">["_id"];
  now: number;
}) {
  return {
    userId: args.userId,
    freeBalance: 0,
    paidBalance: 0,
    lifetimeUsed: 0,
    lastUpdatedAt: args.now,
  };
}

export const ensureCreditsForUser = internalMutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.object({
    creditsId: v.id("credits"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const existing = await getLatestCreditsByUser(ctx, args.userId);
    if (existing) {
      return { creditsId: existing._id, created: false };
    }

    const now = Date.now();
    const creditsId = await ctx.db.insert(
      "credits",
      buildInitialCreditsRecord({
        userId: args.userId,
        now,
      }),
    );

    return { creditsId, created: true };
  },
});

function parsePositiveInteger(input: string | undefined): number | null {
  if (!input) return null;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function getLatestBillingCustomerByUpdatedAt(rows: Doc<"billingCustomers">[]) {
  if (rows.length === 0) return null;
  return rows.reduce((latest, row) =>
    row.updatedAt > latest.updatedAt ? row : latest,
  );
}

async function resolveTopupUserId(
  ctx: MutationCtx,
  args: {
    metadata?: Record<string, string>;
    stripeCustomerId?: string;
  },
): Promise<Id<"users"> | null> {
  const metadataUserId = args.metadata?.userId;

  if (metadataUserId) {
    const user = await ctx.db.get(metadataUserId as Id<"users">);
    if (user) {
      return user._id;
    }
  }

  if (args.stripeCustomerId) {
    const rows = await ctx.db
      .query("billingCustomers")
      .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", args.stripeCustomerId!))
      .collect();
    const latest = getLatestBillingCustomerByUpdatedAt(rows);
    if (latest) {
      return latest.userId;
    }
  }

  return null;
}

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
 * Free credits are capped per subscription tier.
 *
 * DEDUP CONTRACT (CRED-01):
 * Credit grants are deduplicated at the INVOICE ID level, not the event ID level.
 * This is the canonical dedup gate -- both the invoice.paid webhook path and the
 * reconciliation cron path converge on this mutation. The same invoice can arrive
 * via different event IDs (webhook: evt_xxx, cron: reconcile.pull:in_xxx), so
 * event-ID dedup would fail. Invoice-ID dedup catches both.
 *
 * Concurrency safety: Convex mutations are serializable (OCC). Two concurrent
 * mutations attempting to write creditTransactions for the same stripeInvoiceId
 * will conflict -- one succeeds, the other retries and finds the existing record.
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

    let credits: Doc<"credits"> | null = await getLatestCreditsByUser(ctx, subscription.userId);
    if (!credits) {
      const now = Date.now();
      const creditsId = await ctx.db.insert(
        "credits",
        buildInitialCreditsRecord({
          userId: subscription.userId,
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
        message: `Unable to create credits record for user ${subscription.userId}`,
      });
      return createGrantResult({
        outcome: "failed_subscription_lookup",
        decision: "grant",
        classification: "credits_record_missing",
        message: `Unable to create credits record for user ${subscription.userId}`,
      });
    }

    const now = Date.now();
    const cappedGrant = applyTierFreeCreditCap({
      plan: subscription.plan,
      currentFreeBalance: credits.freeBalance,
      amountToAdd: subscription.creditsPerMonth,
    });
    const newFreeBalance = cappedGrant.newFreeBalance;
    const actualGranted = cappedGrant.actualAdded;

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
      description: `Monthly credit grant (${subscription.plan} plan) - ${actualGranted}/${subscription.creditsPerMonth} credits granted`,
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

function selectPurchaseTransactionByPaymentIntent(
  transactions: Doc<"creditTransactions">[],
): Doc<"creditTransactions"> | null {
  const purchases = transactions
    .filter((row) => row.type === "purchase" && row.amount > 0)
    .sort((a, b) => a.createdAt - b.createdAt);
  return purchases[0] ?? null;
}

function sumReversedCredits(
  transactions: Doc<"creditTransactions">[],
): number {
  return transactions
    .filter((row) => row.type === "refund" && row.creditType === "paid" && row.amount < 0)
    .reduce((sum, row) => sum + Math.abs(row.amount), 0);
}

function getRecordedPurchaseAmountCents(
  metadata?: Record<string, string>,
): number | null {
  const chargedAmountCents = parsePositiveInteger(metadata?.chargedAmountCents);
  if (chargedAmountCents !== null) return chargedAmountCents;
  return parsePositiveInteger(metadata?.amountCents);
}

/**
 * IDEMPOTENCY CONTRACT (INFRA-03):
 * Purchase credit grants are deduplicated at the PAYMENT INTENT ID level.
 * selectPurchaseTransactionByPaymentIntent queries creditTransactions by
 * stripePaymentIntentId -- if a purchase record exists, returns "already_granted".
 *
 * Concurrency safety: Convex OCC serializable transactions. Two concurrent
 * mutations for the same stripePaymentIntentId will conflict -- one succeeds,
 * the other retries and finds the existing record.
 */
export const grantPurchasedCreditsFromPaymentIntent = internalMutation({
  args: {
    stripePaymentIntentId: v.string(),
    stripeCustomerId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    amountReceived: v.number(),
    currency: v.string(),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.object({
    outcome: v.string(),
    grantedCredits: v.number(),
    userId: v.optional(v.id("users")),
  }),
  handler: async (ctx, args) => {
    const metadata = args.metadata ?? {};
    const billingType = metadata.billingType;

    if (billingType !== "credit_topup") {
      return {
        outcome: "ignored_non_topup",
        grantedCredits: 0,
      };
    }

    if (args.currency.toLowerCase() !== CREDIT_TOPUP_CURRENCY) {
      throw new ConvexError(
        `Unsupported top-up currency: ${args.currency}. Expected ${CREDIT_TOPUP_CURRENCY}.`,
      );
    }

    const amountReceivedCents = Math.max(0, Math.floor(args.amountReceived));
    if (amountReceivedCents <= 0) {
      throw new ConvexError("Payment amount must be greater than zero");
    }

    const creditsToGrant = parsePositiveInteger(metadata.credits);
    if (creditsToGrant === null) {
      throw new ConvexError("Missing or invalid credits metadata for top-up payment");
    }

    const metadataCreditsPerUsd =
      parsePositiveInteger(metadata.creditsPerUsd) ?? getCreditsPerUsd();
    const expectedMinimumAmountCents = convertCreditsToAmountCents(
      creditsToGrant,
      metadataCreditsPerUsd,
    );
    if (amountReceivedCents < expectedMinimumAmountCents) {
      throw new ConvexError(
        `Payment amount is lower than expected minimum for top-up (${amountReceivedCents} < ${expectedMinimumAmountCents})`,
      );
    }

    const metadataAmountCents = parsePositiveInteger(metadata.amountCents);
    if (metadataAmountCents !== null && amountReceivedCents < metadataAmountCents) {
      throw new ConvexError(
        `Payment amount is lower than declared checkout amount (${amountReceivedCents} < ${metadataAmountCents})`,
      );
    }

    const existingTransactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_stripe_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId))
      .collect();

    const existingPurchase = selectPurchaseTransactionByPaymentIntent(existingTransactions);
    if (existingPurchase) {
      return {
        outcome: "already_granted",
        grantedCredits: 0,
        userId: existingPurchase.userId,
      };
    }

    const userId = await resolveTopupUserId(ctx, {
      metadata,
      stripeCustomerId: args.stripeCustomerId,
    });
    if (!userId) {
      throw new ConvexError(
        `Unable to resolve user for top-up payment intent ${args.stripePaymentIntentId}`,
      );
    }

    let credits = await getLatestCreditsByUser(ctx, userId);
    if (!credits) {
      const now = Date.now();
      const creditsId = await ctx.db.insert(
        "credits",
        buildInitialCreditsRecord({
          userId,
          now,
        }),
      );
      credits = await ctx.db.get(creditsId);
    }

    if (!credits) {
      throw new ConvexError(`Unable to create credits record for user ${userId}`);
    }

    const now = Date.now();
    const newPaidBalance = credits.paidBalance + creditsToGrant;

    await ctx.db.patch(credits._id, {
      paidBalance: newPaidBalance,
      lastUpdatedAt: now,
    });

    const transactionMetadata: Record<string, string> = {
      ...metadata,
      chargedAmountCents: String(amountReceivedCents),
      eventCurrency: args.currency.toLowerCase(),
      appliedCreditsPerUsd: String(metadataCreditsPerUsd),
    };

    await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      userId,
      type: "purchase",
      creditType: "paid",
      amount: creditsToGrant,
      balanceAfter: newPaidBalance,
      description: `Credit top-up purchase (${creditsToGrant} credits)`,
      metadata: transactionMetadata,
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeChargeId: args.stripeChargeId,
      createdAt: now,
    });

    return {
      outcome: "granted",
      grantedCredits: creditsToGrant,
      userId,
    };
  },
});

/**
 * IDEMPOTENCY CONTRACT (INFRA-03):
 * Refund reversals are deduplicated via cumulative delta calculation.
 * Stripe's charge.amount_refunded is cumulative (not incremental), so
 * targetReversedCredits is always the same for the same refund state.
 * alreadyReversedCredits sums existing refund transactions. The delta
 * (target - already) is 0 on replay, producing no additional deduction.
 *
 * Concurrency safety: Convex OCC serializable transactions. Two concurrent
 * refund mutations for the same charge will serialize -- one processes the
 * delta, the other finds delta=0 and returns "already_reversed".
 */
export const reversePurchasedCreditsFromRefund = internalMutation({
  args: {
    stripeChargeId: v.string(),
    stripePaymentIntentId: v.string(),
    amountRefunded: v.number(),
    chargeAmount: v.number(),
  },
  returns: v.object({
    outcome: v.string(),
    reversedCredits: v.number(),
  }),
  handler: async (ctx, args) => {
    const refundedAmountCents = Math.max(0, Math.floor(args.amountRefunded));
    const chargeAmountCents = Math.max(0, Math.floor(args.chargeAmount));

    if (refundedAmountCents <= 0) {
      return { outcome: "ignored_zero_refund", reversedCredits: 0 };
    }

    const transactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_stripe_payment_intent", (q) =>
        q.eq("stripePaymentIntentId", args.stripePaymentIntentId))
      .collect();

    const purchase = selectPurchaseTransactionByPaymentIntent(transactions);
    if (!purchase) {
      return { outcome: "ignored_no_purchase", reversedCredits: 0 };
    }

    const purchaseMetadata =
      (purchase.metadata as Record<string, string> | undefined) ?? undefined;
    const purchaseAmountCents =
      getRecordedPurchaseAmountCents(purchaseMetadata) ?? chargeAmountCents;

    if (purchaseAmountCents <= 0) {
      throw new ConvexError(
        `Invalid original purchase amount for payment intent ${args.stripePaymentIntentId}`,
      );
    }

    const alreadyReversedCredits = sumReversedCredits(transactions);
    const targetReversedCredits = calculateRefundTargetCredits({
      purchasedCredits: purchase.amount,
      purchaseAmountCents,
      refundedAmountCents,
    });
    const reversalDelta = calculateRefundDeltaCredits({
      targetReversedCredits,
      alreadyReversedCredits,
    });

    if (reversalDelta <= 0) {
      return { outcome: "already_reversed", reversedCredits: 0 };
    }

    const credits = await ctx.db.get(purchase.creditsId);
    if (!credits) {
      throw new ConvexError(
        `Credits record missing for purchase transaction ${purchase._id}`,
      );
    }

    const now = Date.now();
    const newPaidBalance = credits.paidBalance - reversalDelta;

    await ctx.db.patch(credits._id, {
      paidBalance: newPaidBalance,
      lastUpdatedAt: now,
    });

    await ctx.db.insert("creditTransactions", {
      creditsId: credits._id,
      userId: purchase.userId,
      type: "refund",
      creditType: "paid",
      amount: -reversalDelta,
      balanceAfter: newPaidBalance,
      description: `Credit top-up refund reversal (${reversalDelta} credits)`,
      metadata: {
        refundedAmountCents: String(refundedAmountCents),
        purchaseAmountCents: String(purchaseAmountCents),
        targetReversedCredits: String(targetReversedCredits),
        alreadyReversedCredits: String(alreadyReversedCredits),
      },
      stripePaymentIntentId: args.stripePaymentIntentId,
      stripeChargeId: args.stripeChargeId,
      createdAt: now,
    });

    return {
      outcome: "reversed",
      reversedCredits: reversalDelta,
    };
  },
});

/**
 * TOCTOU CONTRACT (INFRA-04):
 *
 * Credit deduction race condition analysis and mitigation strategy.
 * Consumes free credits first, then paid credits.
 *
 * ## Current Protection
 * This mutation is atomic: it reads the balance, checks sufficiency, and writes
 * the deduction within a single Convex mutation transaction. Convex OCC provides
 * serializable isolation -- two concurrent deductCredits mutations touching the
 * same credits record will conflict. One commits, the other retries with fresh
 * data (up to 32 retries with exponential backoff).
 *
 * The critical invariant is that the sufficiency check (`totalAvailable < amount`)
 * is INSIDE this mutation, not in the calling action. This means even if two
 * actions concurrently decide the user "has enough credits" and both call
 * deductCredits, the OCC serialization ensures:
 * - First mutation: reads balance=100, deducts 80, commits balance=20
 * - Second mutation: retries, reads balance=20, deducts 80, throws INSUFFICIENT_CREDITS
 *
 * ## Theoretical Risk Window
 * The action-level pattern `query(balance) -> business logic -> mutation(deduct)`
 * has a gap where stale balance data could inform business logic decisions. However,
 * the mutation-level re-read prevents financial incorrectness (negative balances).
 * The gap only causes UX issues: a user might start an operation expecting success
 * but get INSUFFICIENT_CREDITS when the mutation runs.
 *
 * ## Why This Is Safe Today
 * No user can reach a negative balance. The worst case is a rejected deduction that
 * the user expected to succeed. This is correct behavior for concurrent usage.
 *
 * ## Trigger for Additional Mitigation
 * Implement additional mitigation ONLY on observed incident: a real double-deduction
 * producing a negative balance in production. This would indicate a bug in the
 * mutation logic (sufficiency check bypassed), not an OCC failure.
 *
 * ## Recommended Mitigation Path (when trigger hits)
 * Option A (preferred): Route all deductCredits callers through a per-user workpool
 * with maxParallelism: 1. This serializes deduction requests at the action level,
 * eliminating the gap entirely.
 * Option B: Add a version field to the credits record and assert expected version
 * in the mutation (optimistic locking on top of OCC -- defense in depth).
 */
export const deductCredits = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    description: v.optional(v.string()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    requireCreditsEnabled();
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
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
    userId: v.id("users"),
    amount: v.number(),
    type: v.union(v.literal("grant"), v.literal("refund")),
    creditType: v.union(v.literal("free"), v.literal("paid")),
    description: v.optional(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    if (!credits) throw new ConvexError({ code: "NOT_FOUND", message: "Credits record not found" });

    const now = Date.now();
    let newFreeBalance = credits.freeBalance;
    let newPaidBalance = credits.paidBalance;
    let actualAdded = args.amount;

    if (args.creditType === "free") {
      const subscriptions = await ctx.db
        .query("subscriptions")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .order("desc")
        .collect();
      const subscription = selectCanonicalSubscription(subscriptions);
      const effectivePlan = resolveEffectivePlan(subscription);

      const cappedAddition = applyTierFreeCreditCap({
        plan: effectivePlan,
        currentFreeBalance: credits.freeBalance,
        amountToAdd: args.amount,
      });
      newFreeBalance = cappedAddition.newFreeBalance;
      actualAdded = cappedAddition.actualAdded;
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
