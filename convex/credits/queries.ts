import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";
import { creditBalanceValidator, creditTransactionValidator } from "../lib/validators";
import { components } from "../_generated/api";
import { getCreditTopupCatalog, getCreditsPerUsd } from "../lib/creditTopups";


export const TRACKED_GRANT_EVENT_TYPES = [
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.reconcile",
  "invoice.reconcile.pull",
] as const;

export function selectLatestTrackedGrantEvent<T extends { eventType: string; updatedAt: number }>(
  events: T[],
) {
  return events
    .filter((row) =>
      TRACKED_GRANT_EVENT_TYPES.includes(
        row.eventType as (typeof TRACKED_GRANT_EVENT_TYPES)[number],
      ),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export const getMyBalance = query({
  args: {},
  returns: v.union(creditBalanceValidator, v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (!credits) {
      return { free: 0, paid: 0, total: 0 };
    }

    return {
      free: credits.freeBalance,
      paid: credits.paidBalance,
      total: credits.freeBalance + credits.paidBalance,
    };
  },
});

export const getTransactions = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(creditTransactionValidator),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (!credits) return [];

    const transactions = await ctx.db
      .query("creditTransactions")
      .withIndex("by_credits", (q) => q.eq("creditsId", credits._id))
      .order("desc")
      .take(args.limit ?? 50);

    return transactions;
  },
});

export const checkBalance = query({
  args: {
    requiredAmount: v.number(),
  },
  returns: v.union(
    v.object({
      hasEnough: v.boolean(),
      free: v.number(),
      paid: v.number(),
      total: v.number(),
      required: v.number(),
      deficit: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    const free = credits?.freeBalance ?? 0;
    const paid = credits?.paidBalance ?? 0;
    const total = free + paid;

    return {
      hasEnough: total >= args.requiredAmount,
      free,
      paid,
      total,
      required: args.requiredAmount,
      deficit: Math.max(0, args.requiredAmount - total),
    };
  },
});

export const getTopupCatalog = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    creditsPerUsd: v.number(),
    bundles: v.array(
      v.object({
        key: v.string(),
        credits: v.number(),
        amountCents: v.number(),
        currency: v.literal("usd"),
      }),
    ),
  }),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const topupsEnabled = process.env.NEXT_PUBLIC_CREDIT_TOPUPS_ENABLED !== "false";
    const creditsPerUsd = getCreditsPerUsd();

    if (!user || !topupsEnabled) {
      return {
        enabled: false,
        creditsPerUsd,
        bundles: [],
      };
    }

    return {
      enabled: true,
      creditsPerUsd,
      bundles: getCreditTopupCatalog(creditsPerUsd),
    };
  },
});

export const getLatestGrantStatus = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      lastGrantAt: v.optional(v.number()),
      lastGrantInvoiceId: v.optional(v.string()),
      latestEventStatus: v.optional(v.string()),
      latestEventClassification: v.optional(v.string()),
      latestEventError: v.optional(v.string()),
      latestEventUpdatedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    const grantTransactions = credits
      ? await ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", credits._id))
          .order("desc")
          .take(100)
      : [];

    const lastGrant = grantTransactions.find((tx) => tx.type === "grant");

    const invoiceIds = new Set<string>();
    const subscriptionIds = new Set<string>();

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(10);

    for (const subscription of subscriptions) {
      if (subscription.stripeSubscriptionId) {
        subscriptionIds.add(subscription.stripeSubscriptionId);
      }
    }

    const billingCustomers = await ctx.db
      .query("billingCustomers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const stripeCustomerIds = new Set<string>();
    for (const billingCustomer of billingCustomers) {
      stripeCustomerIds.add(billingCustomer.stripeCustomerId);
    }

    for (const tx of grantTransactions) {
      if (tx.stripeInvoiceId) {
        invoiceIds.add(tx.stripeInvoiceId);
      }
    }

    try {
      const mirroredInvoices: Array<{ stripeInvoiceId: string }> = await ctx.runQuery(
        components.stripe.public.listInvoicesByUserId,
        {
          userId: user._id,
        },
      );
      for (const invoice of mirroredInvoices) {
        invoiceIds.add(invoice.stripeInvoiceId);
      }
    } catch (error) {
      console.warn("[getLatestGrantStatus] Failed to query Stripe invoice mirror", error);
    }

    const objectIds = new Set<string>(invoiceIds);
    for (const subscriptionId of subscriptionIds) {
      objectIds.add(subscriptionId);
    }
    for (const stripeCustomerId of stripeCustomerIds) {
      objectIds.add(stripeCustomerId);
    }

    const eventRows: Array<{
      status: string;
      classification?: string;
      lastError?: string;
      eventType: string;
      updatedAt: number;
    }> = [];

    for (const objectId of objectIds) {
      const rows = await ctx.db
        .query("stripeEventLogs")
        .withIndex("by_object_created", (q) => q.eq("stripeObjectId", objectId))
        .order("desc")
        .take(5);

      for (const row of rows) {
        eventRows.push({
          status: row.status,
          classification: row.classification,
          lastError: row.lastError,
          eventType: row.eventType,
          updatedAt: row.updatedAt,
        });
      }
    }

    const latestRelevantEvent = selectLatestTrackedGrantEvent(eventRows);

    return {
      lastGrantAt: lastGrant?.createdAt,
      lastGrantInvoiceId: lastGrant?.stripeInvoiceId,
      latestEventStatus: latestRelevantEvent?.status,
      latestEventClassification: latestRelevantEvent?.classification,
      latestEventError: latestRelevantEvent?.lastError,
      latestEventUpdatedAt: latestRelevantEvent?.updatedAt,
    };
  },
});
