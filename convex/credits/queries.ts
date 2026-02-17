import { query } from "../_generated/server";
import { v } from "convex/values";
import { getCurrentUser } from "../lib/auth";
import { creditBalanceValidator, creditTransactionValidator } from "../lib/validators";
import { components } from "../_generated/api";

const componentApi = components as any;

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

/**
 * Get current user's credit balance (free + paid)
 */
export const getMyBalance = query({
  args: {},
  returns: v.union(creditBalanceValidator, v.null()),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", user._id).eq("ownerType", "user")
      )
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

/**
 * Get organization's credit balance
 */
export const getOrgBalance = query({
  args: { organizationId: v.id("organizations") },
  returns: v.union(creditBalanceValidator, v.null()),
  handler: async (ctx, { organizationId }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_org", (q) =>
        q.eq("userId", user._id).eq("organizationId", organizationId)
      )
      .unique();
    if (!membership) return null;

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", organizationId).eq("ownerType", "organization")
      )
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

/**
 * Get credit transaction history
 */
export const getTransactions = query({
  args: {
    organizationId: v.optional(v.id("organizations")),
    limit: v.optional(v.number()),
  },
  returns: v.array(creditTransactionValidator),
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";

    if (args.organizationId) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user_org", (q) =>
          q.eq("userId", user._id).eq("organizationId", args.organizationId!)
        )
        .unique();
      if (!membership) return [];
    }

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
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

/**
 * Check if user/org has enough credits
 */
export const checkBalance = query({
  args: {
    organizationId: v.optional(v.id("organizations")),
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

    if (args.organizationId) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_user_org", (q) =>
          q.eq("userId", user._id).eq("organizationId", args.organizationId!)
        )
        .unique();
      if (!membership) return null;
    }

    const ownerId = args.organizationId ?? user._id;
    const ownerType = args.organizationId ? "organization" : "user";

    const credits = await ctx.db
      .query("credits")
      .withIndex("by_owner", (q) =>
        q.eq("ownerId", ownerId).eq("ownerType", ownerType)
      )
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
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id).eq("ownerType", "user"))
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
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id).eq("ownerType", "user"))
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
        componentApi.stripe.public.listInvoicesByUserId,
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

    const eventRowsByObject = (
      await Promise.all(
        Array.from(objectIds).map((stripeObjectId) =>
          ctx.db
            .query("stripeEventLogs")
            .withIndex("by_object_created", (q) => q.eq("stripeObjectId", stripeObjectId))
            .order("desc")
            .take(10),
        ),
      )
    ).flat();

    const eventRowsBySyntheticId = (
      await Promise.all(
        Array.from(invoiceIds).flatMap((invoiceId) => [
          ctx.db
            .query("stripeEventLogs")
            .withIndex("by_stripe_event_id", (q) => q.eq("stripeEventId", `invoice.reconcile:${invoiceId}`))
            .collect(),
          ctx.db
            .query("stripeEventLogs")
            .withIndex("by_stripe_event_id", (q) => q.eq("stripeEventId", `reconcile.pull:${invoiceId}`))
            .collect(),
        ]),
      )
    ).flat();

    const latestEvents = [...eventRowsByObject, ...eventRowsBySyntheticId];

    const latestEvent = selectLatestTrackedGrantEvent(latestEvents);

    return {
      lastGrantAt: lastGrant?.createdAt,
      lastGrantInvoiceId: lastGrant?.stripeInvoiceId,
      latestEventStatus: latestEvent?.status,
      latestEventClassification: latestEvent?.classification,
      latestEventError: latestEvent?.lastError,
      latestEventUpdatedAt: latestEvent?.updatedAt,
    };
  },
});
