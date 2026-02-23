"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import Stripe from "stripe";
import {
  classifyMonthlyCreditInvoice,
  isEligibleMonthlyCreditBillingReason,
} from "./lib/invoiceGrantPolicy";
import {
  getCreditGrantRetryDelayMs,
  shouldRetryCreditGrant,
} from "./lib/retryPolicy";

const internalApi = internal as any;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "dummy", {
  apiVersion: "2026-01-28.clover",
});

export type StripeInvoiceReconcileLike = {
  id: string;
  status?: string | null;
  created: number;
  amount_paid?: number | null;
  billing_reason?: string | null;
  subscription?: string | { id?: string | null } | null;
  customer?: string | { id?: string | null } | null;
  lines?: {
    data?: Array<{
      subscription?: string | { id?: string | null } | null;
      parent?: {
        subscription_item_details?: {
          subscription?: string | null;
        } | null;
      } | null;
      subscription_details?: {
        subscription?: string | null;
      } | null;
    }>;
  } | null;
};

export function selectReconcileInvoiceCandidates(args: {
  invoices: StripeInvoiceReconcileLike[];
  cutoffUnixSeconds: number;
}): Array<{
  invoiceId: string;
}> {
  const seenInvoiceIds = new Set<string>();
  const selected: Array<{
    invoiceId: string;
  }> = [];

  for (const invoice of args.invoices) {
    if (invoice.created < args.cutoffUnixSeconds) continue;
    if (invoice.status !== "paid") continue;
    if (seenInvoiceIds.has(invoice.id)) continue;

    seenInvoiceIds.add(invoice.id);
    selected.push({
      invoiceId: invoice.id,
    });
  }

  return selected;
}

export function extractSubscriptionIdFromInvoiceLike(
  invoice: StripeInvoiceReconcileLike,
): string | undefined {
  if (typeof invoice.subscription === "string" && invoice.subscription.length > 0) {
    return invoice.subscription;
  }
  if (invoice.subscription && typeof invoice.subscription === "object") {
    const nested = invoice.subscription.id;
    if (typeof nested === "string" && nested.length > 0) {
      return nested;
    }
  }

  const lines = invoice.lines?.data ?? [];
  for (const line of lines) {
    if (typeof line.subscription === "string" && line.subscription.length > 0) {
      return line.subscription;
    }
    if (
      line.subscription &&
      typeof line.subscription === "object" &&
      typeof line.subscription.id === "string" &&
      line.subscription.id.length > 0
    ) {
      return line.subscription.id;
    }
    const parentSub = line.parent?.subscription_item_details?.subscription;
    if (typeof parentSub === "string" && parentSub.length > 0) {
      return parentSub;
    }
    const detailsSub = line.subscription_details?.subscription;
    if (typeof detailsSub === "string" && detailsSub.length > 0) {
      return detailsSub;
    }
  }

  return undefined;
}

function getInvoiceCustomerId(invoice: StripeInvoiceReconcileLike): string | undefined {
  if (typeof invoice.customer === "string" && invoice.customer.length > 0) {
    return invoice.customer;
  }
  if (invoice.customer && typeof invoice.customer === "object") {
    if (typeof invoice.customer.id === "string" && invoice.customer.id.length > 0) {
      return invoice.customer.id;
    }
  }
  return undefined;
}

export function selectSingletonEntitledSubscriptionId(
  subscriptions: Array<{ id: string; status: string }>,
): string | undefined {
  const eligible = subscriptions.filter((subscription) =>
    subscription.status === "active" ||
    subscription.status === "trialing" ||
    subscription.status === "past_due",
  );

  if (eligible.length === 1) return eligible[0]?.id;
  return undefined;
}

async function resolveFallbackSubscriptionId(
  stripeCustomerId: string,
): Promise<string | undefined> {
  const subscriptions = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "all",
    limit: 100,
  });
  return selectSingletonEntitledSubscriptionId(subscriptions.data);
}

async function processInvoiceForGrantLogic(ctx: any, args: any) {
  const retryCount = args.retryCount ?? 0;
  const stripeEventId = args.stripeEventId ?? `invoice.process:${args.stripeInvoiceId}`;
  const stripeEventType = args.stripeEventType ?? "invoice.process";

  const invoice = (await stripe.invoices.retrieve(args.stripeInvoiceId, {
    expand: ["lines.data"],
  })) as unknown as StripeInvoiceReconcileLike;

  const stripeCustomerId = getInvoiceCustomerId(invoice);
  let stripeSubscriptionId = extractSubscriptionIdFromInvoiceLike(invoice);
  const invoiceBillingReason = invoice.billing_reason ?? undefined;

  let usedFallbackSubscription = false;
  if (
    !stripeSubscriptionId &&
    stripeCustomerId &&
    isEligibleMonthlyCreditBillingReason(invoiceBillingReason)
  ) {
    stripeSubscriptionId = await resolveFallbackSubscriptionId(stripeCustomerId);
    usedFallbackSubscription = Boolean(stripeSubscriptionId);
  }

  if (
    !stripeSubscriptionId &&
    stripeCustomerId &&
    isEligibleMonthlyCreditBillingReason(invoiceBillingReason)
  ) {
    if (shouldRetryCreditGrant(retryCount)) {
      const retryDelayMs = getCreditGrantRetryDelayMs(retryCount);
      if (retryDelayMs !== null) {
        const retryAt = Date.now() + retryDelayMs;
        await ctx.runMutation(internalApi.subscriptions.internal.markStripeEventRetrying, {
          stripeEventId,
          eventType: stripeEventType,
          stripeObjectId: args.stripeInvoiceId,
          classification: "retry_missing_subscription_pointer",
          retryAt,
          reason:
            "Unable to resolve subscription from invoice payload. Retrying with hydration.",
        });
        await ctx.scheduler.runAfter(
          retryDelayMs,
          internalApi.credits.actions.processInvoiceForGrant,
          {
            ...args,
            retryCount: retryCount + 1,
          },
        );
      }

      return {
        outcome: "retrying_subscription_pointer_resolution",
        message:
          "Subscription pointer unresolved for eligible invoice; retry scheduled.",
        usedFallbackSubscription,
      };
    }

    await ctx.runMutation(internalApi.subscriptions.internal.markStripeEventFailed, {
      stripeEventId,
      eventType: stripeEventType,
      stripeObjectId: args.stripeInvoiceId,
      classification: "subscription_pointer_unresolved",
      errorMessage:
        "Eligible subscription invoice is missing a resolvable subscription pointer.",
    });
    return {
      outcome: "failed_subscription_pointer_resolution",
      message:
        "Eligible subscription invoice is missing a resolvable subscription pointer.",
      usedFallbackSubscription,
    };
  }

  const decision = classifyMonthlyCreditInvoice({
    invoiceBillingReason,
    invoiceStatus: invoice.status ?? undefined,
    stripeSubscriptionId: stripeSubscriptionId ?? undefined,
  });

  if (decision.decision === "retry_with_reconcile" && shouldRetryCreditGrant(retryCount)) {
    const retryDelayMs = getCreditGrantRetryDelayMs(retryCount);
    if (retryDelayMs !== null) {
      const retryAt = Date.now() + retryDelayMs;
      await ctx.runMutation(internalApi.subscriptions.internal.markStripeEventRetrying, {
        stripeEventId,
        eventType: stripeEventType,
        stripeObjectId: args.stripeInvoiceId,
        classification: decision.classification,
        retryAt,
        reason: decision.reason,
      });
      await ctx.scheduler.runAfter(
        retryDelayMs,
        internalApi.credits.actions.processInvoiceForGrant,
        {
          ...args,
          retryCount: retryCount + 1,
        },
      );
    }

    return {
      outcome: "retrying_invoice_not_paid",
      message: decision.reason,
      usedFallbackSubscription,
    };
  }

  const result: { outcome: string; message: string } = await ctx.runMutation(
    internalApi.credits.internal.grantMonthlyCredits,
    {
      stripeSubscriptionId: stripeSubscriptionId ?? undefined,
      stripeCustomerId: stripeCustomerId ?? undefined,
      stripeInvoiceId: args.stripeInvoiceId,
      amountPaid: typeof invoice.amount_paid === "number" ? invoice.amount_paid : undefined,
      invoiceStatus: invoice.status ?? undefined,
      invoiceBillingReason,
      stripeEventId,
      stripeEventType,
      retryCount: 0,
    },
  );

  return {
    outcome: result.outcome,
    message: result.message,
    usedFallbackSubscription,
  };
}

export const processInvoiceForGrant = internalAction({
  args: {
    stripeInvoiceId: v.string(),
    stripeEventId: v.optional(v.string()),
    stripeEventType: v.optional(v.string()),
    trigger: v.optional(v.string()),
    retryCount: v.optional(v.number()),
  },
  returns: v.object({
    outcome: v.string(),
    message: v.string(),
    usedFallbackSubscription: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return processInvoiceForGrantLogic(ctx, args);
  },
});

async function reconcileRecentPaidInvoicesFromStripeLogic(ctx: any, args: any) {
  const lookbackDays = args.lookbackDays ?? 7;
  const cutoffUnixSeconds = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
  const limitCustomers = Math.max(1, Math.min(args.limitCustomers ?? 200, 1000));

  let customers: string[] = [];
  if (args.stripeCustomerId) {
    customers = [args.stripeCustomerId];
  } else {
    const subscriptions: Array<{
      stripeCustomerId: string;
    }> = await ctx.runQuery(
      internalApi.subscriptions.internal.listGrantEligibleSubscriptionPointers,
      { limit: limitCustomers },
    );

    const deduped = new Set<string>();
    for (const row of subscriptions) {
      if (!row.stripeCustomerId) continue;
      deduped.add(row.stripeCustomerId);
      if (deduped.size >= limitCustomers) break;
    }
    customers = Array.from(deduped);
  }

  let invoicesChecked = 0;
  let grantsTriggered = 0;
  let alreadyGranted = 0;
  let ignored = 0;
  let failed = 0;
  let retried = 0;

  for (const stripeCustomerId of customers) {
    const invoices = await stripe.invoices.list({
      customer: stripeCustomerId,
      created: { gte: cutoffUnixSeconds },
      limit: 100,
    });

    const candidates = selectReconcileInvoiceCandidates({
      invoices: invoices.data,
      cutoffUnixSeconds,
    });

    for (const invoice of candidates) {
      invoicesChecked += 1;

      const syntheticEventId = `reconcile.pull:${invoice.invoiceId}`;
      const syntheticEventType = "invoice.reconcile.pull";
      const result: { outcome: string } = await processInvoiceForGrantLogic(
        ctx,
        {
          stripeInvoiceId: invoice.invoiceId,
          stripeEventId: syntheticEventId,
          stripeEventType: syntheticEventType,
          trigger: args.trigger ?? "reconcileRecentPaidInvoicesFromStripe",
          retryCount: 0,
        },
      );

      if (result.outcome === "granted") {
        grantsTriggered += 1;
        continue;
      }
      if (result.outcome === "already_granted") {
        alreadyGranted += 1;
        continue;
      }
      if (
        result.outcome === "ignored_non_recurring" ||
        result.outcome === "processed_no_credits"
      ) {
        ignored += 1;
        continue;
      }
      if (result.outcome.startsWith("retrying")) {
        retried += 1;
        continue;
      }
      failed += 1;
    }
  }

  return {
    customersScanned: customers.length,
    invoicesChecked,
    grantsTriggered,
    alreadyGranted,
    ignored,
    failed,
    retried,
  };
}

export const reconcileRecentPaidInvoicesFromStripe = internalAction({
  args: {
    stripeCustomerId: v.optional(v.string()),
    lookbackDays: v.optional(v.number()),
    limitCustomers: v.optional(v.number()),
    trigger: v.optional(v.string()),
  },
  returns: v.object({
    customersScanned: v.number(),
    invoicesChecked: v.number(),
    grantsTriggered: v.number(),
    alreadyGranted: v.number(),
    ignored: v.number(),
    failed: v.number(),
    retried: v.number(),
  }),
  handler: async (ctx, args) => {
    return reconcileRecentPaidInvoicesFromStripeLogic(ctx, args);
  },
});

export const backfillBillingAndCredits = internalAction({
  args: {
    limitSubscriptions: v.optional(v.number()),
    lookbackDays: v.optional(v.number()),
  },
  returns: v.object({
    subscriptionsScanned: v.number(),
    billingLinksUpserted: v.number(),
    creditsCreated: v.number(),
    reconcileCustomersScanned: v.number(),
    reconcileInvoicesChecked: v.number(),
    reconcileGrantsTriggered: v.number(),
  }),
  handler: async (ctx, args) => {
    const pointers: Array<{
      ownerId: string;
      stripeCustomerId: string;
      status: string;
    }> = await ctx.runQuery(
      internalApi.subscriptions.internal.listGrantEligibleSubscriptionPointers,
      {
        limit: args.limitSubscriptions ?? 500,
      },
    );

    let billingLinksUpserted = 0;
    let creditsCreated = 0;
    const customerIds = new Set<string>();

    for (const pointer of pointers) {
      customerIds.add(pointer.stripeCustomerId);
      await ctx.runMutation(internalApi.subscriptions.internal.upsertBillingCustomerLink, {
        userId: pointer.ownerId,
        stripeCustomerId: pointer.stripeCustomerId,
        linkedFrom: "backfill",
      });
      billingLinksUpserted += 1;

      const result: { created: boolean } = await ctx.runMutation(
        internalApi.credits.internal.ensureCreditsForOwner,
        {
          ownerId: pointer.ownerId,
          ownerType: "user",
        },
      );
      if (result.created) {
        creditsCreated += 1;
      }
    }

    const reconcile = await reconcileRecentPaidInvoicesFromStripeLogic(ctx,
      {
        lookbackDays: args.lookbackDays ?? 14,
        limitCustomers: Math.max(1, customerIds.size || 1),
        trigger: "backfillBillingAndCredits",
      },
    );

    return {
      subscriptionsScanned: pointers.length,
      billingLinksUpserted,
      creditsCreated,
      reconcileCustomersScanned: reconcile.customersScanned,
      reconcileInvoicesChecked: reconcile.invoicesChecked,
      reconcileGrantsTriggered: reconcile.grantsTriggered,
    };
  },
});
