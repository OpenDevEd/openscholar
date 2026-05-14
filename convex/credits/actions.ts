"use node";

import { action, internalAction, type ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import Stripe from "stripe";
import {
  classifyMonthlyCreditInvoice,
  isEligibleMonthlyCreditBillingReason,
} from "./lib/invoiceGrantPolicy";
import {
  getCreditGrantRetryDelayMs,
  shouldRetryCreditGrant,
} from "./lib/retryPolicy";
import { stripeClient } from "../stripe";
import { getOrCreateValidCustomer } from "../lib/stripeCustomer";
import { requireActionAuth } from "../lib/auth";
import { requireFeatureInAction } from "../featureFlags/guard";
import {
  CREDIT_TOPUP_CURRENCY,
  getCreditsPerUsd,
  getCreditTopupBundle,
} from "../lib/creditTopups";
import { createError } from "../lib/errors";
import { requireAppUrl } from "../lib/env";

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

export const createTopupCheckoutSession = action({
  args: {
    bundleKey: v.string(),
  },
  returns: v.object({
    url: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args): Promise<{ url: string | null }> => {
    await requireFeatureInAction(ctx, "credits.enabled");
    await requireFeatureInAction(ctx, "credits.topups");
    const identity = await requireActionAuth(ctx);

    // Rate limit check
    await ctx.runMutation(internal.lib.rateLimit.consume, {
      name: "checkout-session",
      key: identity.subject,
    });

    const user = await ctx.runQuery(internal.users.internal.getCurrentUser);

    if (!user?._id) {
      throw createError("CREDITS_USER_NOT_FOUND", "Unable to resolve current user");
    }

    const creditsPerUsd = getCreditsPerUsd();
    const bundle = getCreditTopupBundle(args.bundleKey, creditsPerUsd);
    if (!bundle) {
      throw createError("CREDITS_TOPUP_BUNDLE_INVALID", "Invalid credit top-up bundle");
    }

    const creditsProductId = process.env.STRIPE_CREDITS_PRODUCT_ID;
    if (!creditsProductId) {
      throw createError(
        "CREDITS_PRODUCT_NOT_CONFIGURED",
        "STRIPE_CREDITS_PRODUCT_ID is not configured"
      );
    }

    const customer = await getOrCreateValidCustomer(ctx, {
      userId: user._id,
      email: identity.email,
      name: identity.name,
    });

    await ctx.runMutation(internal.subscriptions.internal.upsertBillingCustomerLink, {
      userId: user._id,
      stripeCustomerId: customer.customerId,
      linkedFrom: "credit_topup_checkout",
    });

    const metadata: Record<string, string> = {
      billingType: "credit_topup",
      userId: user._id,
      bundleKey: bundle.key,
      credits: String(bundle.credits),
      amountCents: String(bundle.amountCents),
      creditsPerUsd: String(creditsPerUsd),
    };

    const domain = requireAppUrl();
    const session = await getStripe().checkout.sessions.create({
      customer: customer.customerId,
      mode: "payment",
      success_url: `${domain}/settings/billing?topup=success`,
      cancel_url: `${domain}/settings/billing?topup=canceled`,
      allow_promotion_codes: true,
      customer_update: {
        address: "auto",
      },
      automatic_tax: {
        enabled: true,
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            product: creditsProductId,
            currency: CREDIT_TOPUP_CURRENCY,
            unit_amount: bundle.amountCents,
          },
        },
      ],
      metadata,
      payment_intent_data: {
        metadata,
      },
    });

    return { url: session.url };
  },
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
  const subscriptions = await getStripe().subscriptions.list({
    customer: stripeCustomerId,
    status: "all",
    limit: 100,
  });
  return selectSingletonEntitledSubscriptionId(subscriptions.data);
}

interface ProcessInvoiceForGrantArgs {
  stripeInvoiceId: string;
  stripeEventId?: string;
  stripeEventType?: string;
  trigger?: string;
  retryCount?: number;
}

async function processInvoiceForGrantLogic(ctx: ActionCtx, args: ProcessInvoiceForGrantArgs): Promise<{ outcome: string; message: string; usedFallbackSubscription: boolean }> {
  const retryCount = args.retryCount ?? 0;
  const stripeEventId = args.stripeEventId ?? `invoice.process:${args.stripeInvoiceId}`;
  const stripeEventType = args.stripeEventType ?? "invoice.process";

  const invoice = (await getStripe().invoices.retrieve(args.stripeInvoiceId, {
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
        await ctx.runMutation(internal.subscriptions.internal.markStripeEventRetrying, {
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
          internal.credits.actions.processInvoiceForGrant,
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

    await ctx.runMutation(internal.subscriptions.internal.markStripeEventFailed, {
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
      await ctx.runMutation(internal.subscriptions.internal.markStripeEventRetrying, {
        stripeEventId,
        eventType: stripeEventType,
        stripeObjectId: args.stripeInvoiceId,
        classification: decision.classification,
        retryAt,
        reason: decision.reason,
      });
      await ctx.scheduler.runAfter(
        retryDelayMs,
        internal.credits.actions.processInvoiceForGrant,
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

  // --- Upgrade proration detection (UPGR-01) ---
  // When classifyMonthlyCreditInvoice returns "ignore_non_recurring" for a
  // subscription_update invoice, check if this is an upgrade proration invoice
  // by reading upgrade metadata from the Stripe subscription (with Convex fallback).
  if (
    decision.decision === "ignore_non_recurring" &&
    invoiceBillingReason === "subscription_update" &&
    stripeSubscriptionId
  ) {
    // Query Convex subscription record first for dual-read
    const subRecord = await ctx.runQuery(
      internal.subscriptions.internal.getSubscriptionByStripeId,
      { stripeSubscriptionId },
    );

    const subscription = await getStripe().subscriptions.retrieve(stripeSubscriptionId);
    const meta = subscription.metadata ?? {};

    // Prefer Convex subscription record (BILL-02 migration), fall back to Stripe metadata
    const upgradeFromPlan = subRecord?.pendingFromPlan ?? meta.upgradeFromPlan;
    const upgradeToPlan = subRecord?.pendingToPlan ?? meta.upgradeToPlan;
    const upgradeTimestamp = subRecord?.pendingChangeTimestamp
      ? String(subRecord.pendingChangeTimestamp)
      : meta.upgradeTimestamp;

    // Runtime-validate plan names instead of unsafe type casts
    const validPlans = ["free", "go", "pro", "enterprise"] as const;
    type PlanName = typeof validPlans[number];
    function isPlanName(s: string | undefined): s is PlanName {
      return validPlans.includes(s as PlanName);
    }

    if (upgradeFromPlan && upgradeToPlan && upgradeTimestamp && isPlanName(upgradeFromPlan) && isPlanName(upgradeToPlan)) {
      if (subRecord?.userId) {
        // Read period boundaries from the first subscription item
        // (current_period_start/end moved to SubscriptionItem in Stripe API 2026-01-28)
        const item = subscription.items.data[0];
        const periodStartMs = (item?.current_period_start ?? 0) * 1000;
        const periodEndMs = (item?.current_period_end ?? 0) * 1000;

        const grantResult = await ctx.runMutation(
          internal.credits.internal.grantUpgradeProRataCredits,
          {
            userId: subRecord.userId,
            fromPlan: upgradeFromPlan,
            toPlan: upgradeToPlan,
            currentPeriodStartMs: periodStartMs,
            currentPeriodEndMs: periodEndMs,
            stripeSubscriptionId,
          },
        );

        console.log("[processInvoiceForGrant] Upgrade proration credit grant via webhook path", {
          stripeInvoiceId: args.stripeInvoiceId,
          stripeSubscriptionId,
          upgradeFromPlan,
          upgradeToPlan,
          outcome: grantResult.outcome,
          grantedCredits: grantResult.grantedCredits,
        });

        return {
          outcome: grantResult.outcome,
          message: grantResult.message,
          usedFallbackSubscription,
        };
      }
    }

    // No upgrade metadata or no user found -- fall through to normal ignore
    // (This preserves existing behavior for non-upgrade subscription_update invoices)
  }

  const result: { outcome: string; message: string } = await ctx.runMutation(
    internal.credits.internal.grantMonthlyCredits,
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

interface ReconcileRecentPaidInvoicesArgs {
  stripeCustomerId?: string;
  lookbackDays?: number;
  limitCustomers?: number;
  trigger?: string;
}

async function reconcileRecentPaidInvoicesFromStripeLogic(ctx: ActionCtx, args: ReconcileRecentPaidInvoicesArgs) {
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
      internal.subscriptions.internal.listGrantEligibleSubscriptionPointers,
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
    const MAX_INVOICES_PER_CUSTOMER = 500;
    const allInvoiceData: StripeInvoiceReconcileLike[] = [];
    for await (const invoice of getStripe().invoices.list({
      customer: stripeCustomerId,
      created: { gte: cutoffUnixSeconds },
      limit: 100,
    })) {
      allInvoiceData.push(invoice as unknown as StripeInvoiceReconcileLike);
      if (allInvoiceData.length >= MAX_INVOICES_PER_CUSTOMER) {
        console.warn(
          `[reconcileRecentPaidInvoices] Safety cap reached for customer ${stripeCustomerId}: ${MAX_INVOICES_PER_CUSTOMER} invoices. Some invoices may be skipped.`
        );
        break;
      }
    }

    const candidates = selectReconcileInvoiceCandidates({
      invoices: allInvoiceData,
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
      userId: Id<"users">;
      stripeCustomerId: string;
      status: string;
    }> = await ctx.runQuery(
      internal.subscriptions.internal.listGrantEligibleSubscriptionPointers,
      {
        limit: args.limitSubscriptions ?? 500,
      },
    );

    let billingLinksUpserted = 0;
    let creditsCreated = 0;
    const customerIds = new Set<string>();

    for (const pointer of pointers) {
      customerIds.add(pointer.stripeCustomerId);
      await ctx.runMutation(internal.subscriptions.internal.upsertBillingCustomerLink, {
        userId: pointer.userId,
        stripeCustomerId: pointer.stripeCustomerId,
        linkedFrom: "backfill",
      });
      billingLinksUpserted += 1;

      const result: { created: boolean } = await ctx.runMutation(
        internal.credits.internal.ensureCreditsForUser,
        {
          userId: pointer.userId,
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

const DRIFT_AUDIT_PAGE_SIZE = 50;

/**
 * Hourly reconciliation that compares each user's sharded balance counter
 * against the sum of their `creditTransactions.amount`. Logs (does not
 * fix) any discrepancy — Modern Treasury reconciliation pattern: detect
 * and alert, never silently self-heal. Manual remediation runs through
 * `seedBalanceCountersFromLedger`.
 *
 * Pagination is mandatory: the credits table walk and the per-user
 * ledger walk both happen inside internalQueries so each call stays
 * under the 16 MB per-query read budget regardless of ledger depth.
 */
export const auditBalanceDrift = internalAction({
  args: {},
  returns: v.object({
    usersScanned: v.number(),
    driftDetected: v.number(),
  }),
  handler: async (ctx: ActionCtx) => {
    let cursor: string | null = null;
    let usersScanned = 0;
    let driftDetected = 0;

    while (true) {
      const page: {
        userIds: Id<"users">[];
        nextCursor: string | null;
        isDone: boolean;
      } = await ctx.runQuery(
        internal.credits.internal.listUsersWithCreditsPage,
        { cursor, pageSize: DRIFT_AUDIT_PAGE_SIZE },
      );

      for (const userId of page.userIds) {
        usersScanned += 1;
        const drift = await ctx.runQuery(
          internal.credits.internal.computeBalanceDriftForUser,
          { userId },
        );
        if (drift === null) continue;
        if (drift.driftFree === 0 && drift.driftPaid === 0) continue;

        driftDetected += 1;
        console.error("[auditBalanceDrift] drift detected", {
          userId,
          creditsId: drift.creditsId,
          counterFree: drift.counterFree,
          counterPaid: drift.counterPaid,
          ledgerFree: drift.ledgerFree,
          ledgerPaid: drift.ledgerPaid,
          driftFree: drift.driftFree,
          driftPaid: drift.driftPaid,
        });
      }

      if (page.isDone || page.nextCursor === null) break;
      cursor = page.nextCursor;
    }

    return { usersScanned, driftDetected };
  },
});
