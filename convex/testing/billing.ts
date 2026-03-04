import {
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type BillingStripeObjectIdCollections = {
  stripeCustomerIds: string[];
  stripeSubscriptionIds: string[];
  stripeInvoiceIds: string[];
  stripePaymentIntentIds: string[];
  stripeChargeIds: string[];
};

export function collectBillingStripeObjectIds(args: {
  subscriptions: Array<{
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  }>;
  billingCustomers: Array<{
    stripeCustomerId: string;
  }>;
  creditTransactions: Array<{
    stripeInvoiceId?: string;
    stripePaymentIntentId?: string;
    stripeChargeId?: string;
  }>;
}): BillingStripeObjectIdCollections {
  const stripeCustomerIds = new Set<string>();
  const stripeSubscriptionIds = new Set<string>();
  const stripeInvoiceIds = new Set<string>();
  const stripePaymentIntentIds = new Set<string>();
  const stripeChargeIds = new Set<string>();

  for (const subscription of args.subscriptions) {
    if (subscription.stripeCustomerId) {
      stripeCustomerIds.add(subscription.stripeCustomerId);
    }
    if (subscription.stripeSubscriptionId) {
      stripeSubscriptionIds.add(subscription.stripeSubscriptionId);
    }
  }

  for (const billingCustomer of args.billingCustomers) {
    if (billingCustomer.stripeCustomerId) {
      stripeCustomerIds.add(billingCustomer.stripeCustomerId);
    }
  }

  for (const transaction of args.creditTransactions) {
    if (transaction.stripeInvoiceId) {
      stripeInvoiceIds.add(transaction.stripeInvoiceId);
    }
    if (transaction.stripePaymentIntentId) {
      stripePaymentIntentIds.add(transaction.stripePaymentIntentId);
    }
    if (transaction.stripeChargeId) {
      stripeChargeIds.add(transaction.stripeChargeId);
    }
  }

  return {
    stripeCustomerIds: Array.from(stripeCustomerIds),
    stripeSubscriptionIds: Array.from(stripeSubscriptionIds),
    stripeInvoiceIds: Array.from(stripeInvoiceIds),
    stripePaymentIntentIds: Array.from(stripePaymentIntentIds),
    stripeChargeIds: Array.from(stripeChargeIds),
  };
}

function dedupeById<T extends { _id: Id<any> }>(rows: T[]): T[] {
  const byId = new Map<Id<any>, T>();
  for (const row of rows) {
    byId.set(row._id, row);
  }
  return Array.from(byId.values());
}

async function listCreditTransactionsForUser(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  userId: Id<"users">,
  creditsRows: Doc<"credits">[],
): Promise<Doc<"creditTransactions">[]> {
  const byUser = await ctx.db
    .query("creditTransactions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  const byCredits = (
    await Promise.all(
      creditsRows.map((creditsRow) =>
        ctx.db
          .query("creditTransactions")
          .withIndex("by_credits", (q) => q.eq("creditsId", creditsRow._id))
          .collect(),
      ),
    )
  ).flat();

  return dedupeById([...byUser, ...byCredits]);
}

export const getBillingSnapshotForUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.object({
    user: v.union(
      v.object({
        _id: v.id("users"),
        clerkId: v.string(),
        email: v.string(),
        state: v.string(),
      }),
      v.null()
    ),
    objectIds: v.object({
      stripeCustomerIds: v.array(v.string()),
      stripeSubscriptionIds: v.array(v.string()),
      stripeInvoiceIds: v.array(v.string()),
      stripePaymentIntentIds: v.array(v.string()),
      stripeChargeIds: v.array(v.string()),
    }),
    credits: v.array(v.object({
      _id: v.id("credits"),
      freeBalance: v.number(),
      paidBalance: v.number(),
      lifetimeUsed: v.number(),
      lastUpdatedAt: v.number(),
    })),
    subscriptions: v.array(v.object({
      _id: v.id("subscriptions"),
      plan: v.string(),
      status: v.string(),
      stripeSubscriptionId: v.optional(v.string()),
      stripeCustomerId: v.optional(v.string()),
      creditsPerMonth: v.optional(v.number()),
      currentPeriodStart: v.optional(v.number()),
      currentPeriodEnd: v.optional(v.number()),
      updatedAt: v.number(),
    })),
    billingCustomers: v.array(v.object({
      _id: v.id("billingCustomers"),
      stripeCustomerId: v.string(),
      linkedFrom: v.string(),
      updatedAt: v.number(),
    })),
    creditTransactions: v.array(v.object({
      _id: v.id("creditTransactions"),
      type: v.string(),
      creditType: v.string(),
      amount: v.number(),
      balanceAfter: v.number(),
      description: v.optional(v.string()),
      stripeInvoiceId: v.optional(v.string()),
      stripePaymentIntentId: v.optional(v.string()),
      stripeChargeId: v.optional(v.string()),
      metadata: v.optional(v.record(v.string(), v.string())),
      createdAt: v.number(),
    })),
    stripeEventLogs: v.array(v.object({
      _id: v.id("stripeEventLogs"),
      stripeEventId: v.string(),
      eventType: v.string(),
      stripeObjectId: v.optional(v.string()),
      status: v.string(),
      classification: v.optional(v.string()),
      attemptCount: v.number(),
      lastError: v.optional(v.string()),
      nextRetryAt: v.optional(v.number()),
      updatedAt: v.number(),
    })),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);

    const creditsRows = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const billingCustomers = await ctx.db
      .query("billingCustomers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const creditTransactions = await listCreditTransactionsForUser(
      ctx,
      args.userId,
      creditsRows,
    );

    const objectIds = collectBillingStripeObjectIds({
      subscriptions,
      billingCustomers,
      creditTransactions,
    });

    const stripeObjectIds = new Set<string>([
      ...objectIds.stripeCustomerIds,
      ...objectIds.stripeSubscriptionIds,
      ...objectIds.stripeInvoiceIds,
      ...objectIds.stripePaymentIntentIds,
      ...objectIds.stripeChargeIds,
    ]);

    const stripeEventLogs = (
      await Promise.all(
        Array.from(stripeObjectIds).map((objectId) =>
          ctx.db
            .query("stripeEventLogs")
            .withIndex("by_object_created", (q) => q.eq("stripeObjectId", objectId))
            .collect(),
        ),
      )
    ).flat();

    const dedupedEventLogs = dedupeById(stripeEventLogs).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );

    return {
      user: user
        ? {
            _id: user._id,
            clerkId: user.clerkId,
            email: user.email,
            state: user.state,
          }
        : null,
      objectIds,
      credits: creditsRows.map((row) => ({
        _id: row._id,
        freeBalance: row.freeBalance,
        paidBalance: row.paidBalance,
        lifetimeUsed: row.lifetimeUsed,
        lastUpdatedAt: row.lastUpdatedAt,
      })),
      subscriptions: subscriptions
        .map((row) => ({
          _id: row._id,
          plan: row.plan,
          status: row.status,
          stripeSubscriptionId: row.stripeSubscriptionId,
          stripeCustomerId: row.stripeCustomerId,
          creditsPerMonth: row.creditsPerMonth,
          currentPeriodStart: row.currentPeriodStart,
          currentPeriodEnd: row.currentPeriodEnd,
          updatedAt: row.updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      billingCustomers: billingCustomers
        .map((row) => ({
          _id: row._id,
          stripeCustomerId: row.stripeCustomerId,
          linkedFrom: row.linkedFrom,
          updatedAt: row.updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      creditTransactions: creditTransactions
        .map((row) => ({
          _id: row._id,
          type: row.type,
          creditType: row.creditType,
          amount: row.amount,
          balanceAfter: row.balanceAfter,
          description: row.description,
          stripeInvoiceId: row.stripeInvoiceId,
          stripePaymentIntentId: row.stripePaymentIntentId,
          stripeChargeId: row.stripeChargeId,
          metadata: row.metadata,
          createdAt: row.createdAt,
        }))
        .sort((a, b) => b.createdAt - a.createdAt),
      stripeEventLogs: dedupedEventLogs.map((row) => ({
        _id: row._id,
        stripeEventId: row.stripeEventId,
        eventType: row.eventType,
        stripeObjectId: row.stripeObjectId,
        status: row.status,
        classification: row.classification,
        attemptCount: row.attemptCount,
        lastError: row.lastError,
        nextRetryAt: row.nextRetryAt,
        updatedAt: row.updatedAt,
      })),
    };
  },
});

export const resetBillingStateForUser = internalMutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.object({
    creditsDeleted: v.number(),
    creditTransactionsDeleted: v.number(),
    subscriptionsDeleted: v.number(),
    billingCustomersDeleted: v.number(),
    stripeEventLogsDeleted: v.number(),
    stripeObjectIdsSeen: v.number(),
  }),
  handler: async (ctx, args) => {
    const creditsRows = await ctx.db
      .query("credits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const billingCustomers = await ctx.db
      .query("billingCustomers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const creditTransactions = await listCreditTransactionsForUser(ctx, args.userId, creditsRows);

    const objectIds = collectBillingStripeObjectIds({
      subscriptions,
      billingCustomers,
      creditTransactions,
    });

    const stripeObjectIdSet = new Set<string>([
      ...objectIds.stripeCustomerIds,
      ...objectIds.stripeSubscriptionIds,
      ...objectIds.stripeInvoiceIds,
      ...objectIds.stripePaymentIntentIds,
      ...objectIds.stripeChargeIds,
    ]);

    const stripeEventLogs = dedupeById(
      (
        await Promise.all(
          Array.from(stripeObjectIdSet).map((objectId) =>
            ctx.db
              .query("stripeEventLogs")
              .withIndex("by_object_created", (q) => q.eq("stripeObjectId", objectId))
              .collect(),
          ),
        )
      ).flat(),
    );

    for (const row of stripeEventLogs) {
      await ctx.db.delete(row._id);
    }

    for (const row of creditTransactions) {
      await ctx.db.delete(row._id);
    }

    for (const row of subscriptions) {
      await ctx.db.delete(row._id);
    }

    for (const row of billingCustomers) {
      await ctx.db.delete(row._id);
    }

    for (const row of creditsRows) {
      await ctx.db.delete(row._id);
    }

    return {
      creditsDeleted: creditsRows.length,
      creditTransactionsDeleted: creditTransactions.length,
      subscriptionsDeleted: subscriptions.length,
      billingCustomersDeleted: billingCustomers.length,
      stripeEventLogsDeleted: stripeEventLogs.length,
      stripeObjectIdsSeen: stripeObjectIdSet.size,
    };
  },
});
