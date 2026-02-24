import { internalMutation, internalQuery, MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { PLAN_CONFIG, getPlanFromPriceId } from "../lib/constants";
import { Doc, Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { components } from "../_generated/api";
import {
  subscriptionValidator,
  type SubscriptionStatus,
} from "../lib/validators";
import { selectCanonicalSubscription } from "./lib/selectCanonicalSubscription";
import {
  shouldSkipProcessedTransition,
  type StripeEventLogStatus,
} from "./lib/eventLogPolicy";

const componentApi = components as any;

type StripeMetadata = {
  userId?: string;
};

type StripeEventLogClassification = string;

async function upsertStripeEventLog(
  ctx: MutationCtx,
  args: {
    stripeEventId: string;
    eventType: string;
    status: StripeEventLogStatus;
    stripeObjectId?: string;
    stripeApiVersion?: string;
    classification?: StripeEventLogClassification;
    errorMessage?: string;
    nextRetryAt?: number;
    processedAt?: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("stripeEventLogs")
    .withIndex("by_stripe_event_id", (q) => q.eq("stripeEventId", args.stripeEventId))
    .first();

  const now = Date.now();

  if (!existing) {
    await ctx.db.insert("stripeEventLogs", {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      stripeObjectId: args.stripeObjectId,
      stripeApiVersion: args.stripeApiVersion,
      classification: args.classification,
      status: args.status,
      attemptCount: args.status === "retrying" || args.status === "failed" ? 1 : 0,
      lastError: args.errorMessage,
      nextRetryAt: args.nextRetryAt,
      createdAt: now,
      updatedAt: now,
      lastProcessedAt: args.processedAt,
    });
    return;
  }

  const nextAttemptCount =
    args.status === "retrying" || args.status === "failed"
      ? existing.attemptCount + 1
      : existing.attemptCount;

  await ctx.db.patch(existing._id, {
    eventType: args.eventType,
    stripeObjectId: args.stripeObjectId ?? existing.stripeObjectId,
    stripeApiVersion: args.stripeApiVersion ?? existing.stripeApiVersion,
    classification: args.classification ?? existing.classification,
    status: args.status,
    attemptCount: nextAttemptCount,
    lastError: args.errorMessage,
    nextRetryAt: args.nextRetryAt,
    updatedAt: now,
    lastProcessedAt: args.processedAt ?? existing.lastProcessedAt,
  });
}

function selectLatestBillingCustomer(
  rows: Doc<"billingCustomers">[],
): Doc<"billingCustomers"> | null {
  if (rows.length === 0) return null;
  return rows.reduce((latest, row) =>
    row.updatedAt > latest.updatedAt ? row : latest,
  );
}

async function upsertBillingCustomerLinkRecord(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    stripeCustomerId: string;
    linkedFrom: string;
  },
): Promise<void> {
  const now = Date.now();

  const byUser = await ctx.db
    .query("billingCustomers")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .collect();
  const byStripeCustomer = await ctx.db
    .query("billingCustomers")
    .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", args.stripeCustomerId))
    .collect();

  const base =
    selectLatestBillingCustomer(byStripeCustomer) ??
    selectLatestBillingCustomer(byUser);

  if (!base) {
    await ctx.db.insert("billingCustomers", {
      userId: args.userId,
      stripeCustomerId: args.stripeCustomerId,
      linkedFrom: args.linkedFrom,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.patch(base._id, {
    userId: args.userId,
    stripeCustomerId: args.stripeCustomerId,
    linkedFrom: args.linkedFrom,
    updatedAt: now,
  });

  const duplicateIds = new Set<string>();
  for (const row of byUser) {
    if (row._id !== base._id) duplicateIds.add(row._id);
  }
  for (const row of byStripeCustomer) {
    if (row._id !== base._id) duplicateIds.add(row._id);
  }

  for (const duplicateId of duplicateIds) {
    await ctx.db.delete(duplicateId as Doc<"billingCustomers">["_id"]);
  }
}

async function getSubscriptionByStripeOrMetadata(
  ctx: MutationCtx,
  args: {
    stripeSubscriptionId?: string;
    stripeCustomerId?: string;
    metadata?: StripeMetadata;
  },
): Promise<Doc<"subscriptions"> | null> {
  if (args.stripeSubscriptionId) {
    const bySub = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId!))
      .order("desc")
      .collect();
    const canonical = selectCanonicalSubscription(bySub);
    if (canonical) return canonical;
  }

  if (args.stripeCustomerId) {
    const byCustomer = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", args.stripeCustomerId!))
      .order("desc")
      .collect();
    const canonical = selectCanonicalSubscription(byCustomer);
    if (canonical) return canonical;
  }

  if (args.metadata?.userId) {
    const userId = args.metadata.userId as Id<"users">;
    const subs = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    return selectCanonicalSubscription(subs);
  }

  return null;
}

export const upsertBillingCustomerLink = internalMutation({
  args: {
    userId: v.id("users"),
    stripeCustomerId: v.string(),
    linkedFrom: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await upsertBillingCustomerLinkRecord(ctx, {
      userId: args.userId,
      stripeCustomerId: args.stripeCustomerId,
      linkedFrom: args.linkedFrom ?? "unknown",
    });
    return null;
  },
});

export const getBillingCustomerByUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      stripeCustomerId: v.string(),
      linkedFrom: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("billingCustomers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const row = selectLatestBillingCustomer(rows);
    if (!row) return null;
    return {
      userId: row.userId,
      stripeCustomerId: row.stripeCustomerId,
      linkedFrom: row.linkedFrom,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});

export const getBillingCustomerByStripeCustomer = internalQuery({
  args: {
    stripeCustomerId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.id("users"),
      stripeCustomerId: v.string(),
      linkedFrom: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("billingCustomers")
      .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", args.stripeCustomerId))
      .collect();
    const row = selectLatestBillingCustomer(rows);
    if (!row) return null;
    return {
      userId: row.userId,
      stripeCustomerId: row.stripeCustomerId,
      linkedFrom: row.linkedFrom,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});

export const getSubscriptionByUser = internalQuery({
  args: {
    userId: v.id("users"),
  },
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
    return selectCanonicalSubscription(subscriptions);
  },
});

export const listGrantEligibleSubscriptionPointers = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      userId: v.id("users"),
      stripeCustomerId: v.string(),
      stripeSubscriptionId: v.string(),
      status: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const [active, trialing, pastDue] = await Promise.all([
      ctx.db
        .query("subscriptions")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .order("desc")
        .collect(),
      ctx.db
        .query("subscriptions")
        .withIndex("by_status", (q) => q.eq("status", "trialing"))
        .order("desc")
        .collect(),
      ctx.db
        .query("subscriptions")
        .withIndex("by_status", (q) => q.eq("status", "past_due"))
        .order("desc")
        .collect(),
    ]);

    const sorted = [...active, ...trialing, ...pastDue]
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const deduped: Array<{
      userId: Id<"users">;
      stripeCustomerId: string;
      stripeSubscriptionId: string;
      status: string;
      updatedAt: number;
    }> = [];
    const seen = new Set<string>();
    for (const row of sorted) {
      if (!row.stripeCustomerId || !row.stripeSubscriptionId) continue;
      if (seen.has(row.stripeSubscriptionId)) continue;
      seen.add(row.stripeSubscriptionId);
      deduped.push({
        userId: row.userId,
        stripeCustomerId: row.stripeCustomerId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        status: row.status,
        updatedAt: row.updatedAt,
      });
      if (deduped.length >= (args.limit ?? 250)) {
        break;
      }
    }

    return deduped;
  },
});

export const syncSubscription = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    stripeCustomerId: v.string(),
    status: v.union(
      v.literal("active"),
      v.literal("past_due"),
      v.literal("canceled"),
      v.literal("trialing"),
      v.literal("incomplete"),
      v.literal("incomplete_expired"),
      v.literal("unpaid"),
      v.literal("paused"),
    ),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
    priceId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    metadata: v.optional(v.record(v.string(), v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let subscription = await getSubscriptionByStripeOrMetadata(ctx, {
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeCustomerId: args.stripeCustomerId,
    });

    const metadata = args.metadata as StripeMetadata;
    let userId: Id<"users"> | undefined = subscription?.userId;

    if (!userId && args.stripeCustomerId) {
      const linkedRows = await ctx.db
        .query("billingCustomers")
        .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", args.stripeCustomerId))
        .collect();
      const linked = selectLatestBillingCustomer(linkedRows);
      if (linked) {
        userId = linked.userId;
      }
    }

    if (!userId && args.stripeCustomerId) {
      try {
        const customer = await ctx.runQuery(componentApi.stripe.public.getCustomer, {
          stripeCustomerId: args.stripeCustomerId,
        });
        const componentUserId = customer?.metadata?.userId;
        if (typeof componentUserId === "string" && componentUserId.length > 0) {
          userId = componentUserId as Id<"users">;
        }
      } catch (error) {
        console.warn("[syncSubscription] Failed to resolve customer metadata", error);
      }
    }

    if (!userId && metadata?.userId) {
      userId = metadata.userId as Id<"users">;
    }

    if (!userId) {
      console.error("[syncSubscription] No user ID found from subscription/customer metadata");
      throw new ConvexError({
        code: "INVALID_DATA",
        message: "Cannot sync subscription: no user identifier",
      });
    }

    await upsertBillingCustomerLinkRecord(ctx, {
      userId,
      stripeCustomerId: args.stripeCustomerId,
      linkedFrom: "subscription_sync",
    });

    const plan = getPlanFromPriceId(args.priceId);
    const quantity = args.quantity ?? 1;
    const baseCredits = PLAN_CONFIG[plan].creditsPerMonth;
    const totalCredits = baseCredits * quantity;

    const now = Date.now();

    if (!subscription) {
      await ctx.db.insert("subscriptions", {
        userId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        stripeCustomerId: args.stripeCustomerId,
        plan,
        status: args.status,
        currentPeriodStart: args.currentPeriodStart,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
        seats: quantity,
        creditsPerMonth: totalCredits,
        createdAt: now,
        updatedAt: now,
      });
      return null;
    }

    await ctx.db.patch(subscription._id, {
      userId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      stripeCustomerId: args.stripeCustomerId,
      plan,
      status: args.status,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      seats: quantity,
      creditsPerMonth: totalCredits,
      updatedAt: now,
    });

    return null;
  },
});

export const handleSubscriptionCanceled = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
      .order("desc")
      .collect();
    const subscription = selectCanonicalSubscription(subscriptions);

    if (!subscription) {
      console.log(`[handleSubscriptionCanceled] No subscription found for Stripe ID: ${args.stripeSubscriptionId}`);
      return null;
    }

    const now = Date.now();

    if (subscription.stripeCustomerId) {
      await upsertBillingCustomerLinkRecord(ctx, {
        userId: subscription.userId,
        stripeCustomerId: subscription.stripeCustomerId,
        linkedFrom: "subscription_canceled",
      });
    }

    await ctx.db.patch(subscription._id, {
      status: "canceled",
      canceledAt: now,
      updatedAt: now,
      stripeSubscriptionId: undefined,
    });

    await ctx.db.insert("subscriptions", {
      userId: subscription.userId,
      stripeCustomerId: subscription.stripeCustomerId,
      plan: "free",
      status: "active",
      creditsPerMonth: 0,
      seats: 1,
      createdAt: now,
      updatedAt: now,
    });

    return null;
  },
});

export const handlePaymentFailed = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_sub", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
      .order("desc")
      .collect();
    const subscription = selectCanonicalSubscription(subscriptions);

    if (!subscription) return null;

    await ctx.db.patch(subscription._id, {
      status: "past_due" satisfies SubscriptionStatus,
      updatedAt: Date.now(),
    });

    return null;
  },
});

export const recordStripeEventReceived = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeObjectId: v.optional(v.string()),
    stripeApiVersion: v.optional(v.string()),
    classification: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await upsertStripeEventLog(ctx, {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      stripeObjectId: args.stripeObjectId,
      stripeApiVersion: args.stripeApiVersion,
      classification: args.classification,
      status: "received",
    });
    return null;
  },
});

export const markStripeEventProcessed = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeObjectId: v.optional(v.string()),
    stripeApiVersion: v.optional(v.string()),
    classification: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stripeEventLogs")
      .withIndex("by_stripe_event_id", (q) => q.eq("stripeEventId", args.stripeEventId))
      .first();

    if (
      existing &&
      shouldSkipProcessedTransition({
        status: existing.status,
        nextRetryAt: existing.nextRetryAt,
        now: Date.now(),
      })
    ) {
      return null;
    }

    await upsertStripeEventLog(ctx, {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      stripeObjectId: args.stripeObjectId,
      stripeApiVersion: args.stripeApiVersion,
      classification: args.classification,
      status: "processed",
      processedAt: Date.now(),
    });
    return null;
  },
});

export const markStripeEventRetrying = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeObjectId: v.optional(v.string()),
    stripeApiVersion: v.optional(v.string()),
    classification: v.optional(v.string()),
    retryAt: v.number(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await upsertStripeEventLog(ctx, {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      stripeObjectId: args.stripeObjectId,
      stripeApiVersion: args.stripeApiVersion,
      classification: args.classification,
      status: "retrying",
      nextRetryAt: args.retryAt,
      errorMessage: args.reason,
    });
    return null;
  },
});

export const markStripeEventFailed = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeObjectId: v.optional(v.string()),
    stripeApiVersion: v.optional(v.string()),
    classification: v.optional(v.string()),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await upsertStripeEventLog(ctx, {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      stripeObjectId: args.stripeObjectId,
      stripeApiVersion: args.stripeApiVersion,
      classification: args.classification,
      status: "failed",
      errorMessage: args.errorMessage,
    });
    return null;
  },
});

export const markStripeEventIgnored = internalMutation({
  args: {
    stripeEventId: v.string(),
    eventType: v.string(),
    stripeObjectId: v.optional(v.string()),
    stripeApiVersion: v.optional(v.string()),
    classification: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await upsertStripeEventLog(ctx, {
      stripeEventId: args.stripeEventId,
      eventType: args.eventType,
      stripeObjectId: args.stripeObjectId,
      stripeApiVersion: args.stripeApiVersion,
      classification: args.classification,
      status: "ignored",
      errorMessage: args.reason,
    });
    return null;
  },
});
