import { v } from "convex/values";

export const planValidator = v.union(
  v.literal("free"),
  v.literal("go"),
  v.literal("pro"),
  v.literal("enterprise")
);
export type PlanType = "free" | "go" | "pro" | "enterprise";

export const subscriptionStatusValidator = v.union(
  v.literal("active"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("trialing"),
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("unpaid"),
  v.literal("paused")
);
export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "trialing"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

export const userStateValidator = v.union(
  v.literal("active"),
  v.literal("suspended"),
  v.literal("deleted")
);

export const creditTransactionTypeValidator = v.union(
  v.literal("purchase"),
  v.literal("usage"),
  v.literal("grant"),
  v.literal("refund"),
  v.literal("expiry")
);

export const apiKeyProviderValidator = v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("openrouter")
);

export const userValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  clerkId: v.string(),
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  state: userStateValidator,
  lastLoginAt: v.optional(v.number()),
  libraryItemCount: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const creditsValidator = v.object({
  _id: v.id("credits"),
  _creationTime: v.number(),
  userId: v.id("users"),
  freeBalance: v.number(),
  paidBalance: v.number(),
  lifetimeUsed: v.number(),
  lastUpdatedAt: v.number(),
});

export const creditBalanceValidator = v.object({
  free: v.number(),
  paid: v.number(),
  total: v.number(),
});

export const subscriptionValidator = v.object({
  _id: v.id("subscriptions"),
  _creationTime: v.number(),
  userId: v.id("users"),
  stripeSubscriptionId: v.optional(v.string()),
  stripeCustomerId: v.optional(v.string()),
  plan: planValidator,
  status: subscriptionStatusValidator,
  currentPeriodStart: v.optional(v.number()),
  currentPeriodEnd: v.optional(v.number()),
  cancelAtPeriodEnd: v.optional(v.boolean()),
  canceledAt: v.optional(v.number()),
  pastDueSince: v.optional(v.number()),
  creditsPerMonth: v.optional(v.number()),
  seats: v.optional(v.number()),
  pendingFromPlan: v.optional(planValidator),
  pendingToPlan: v.optional(planValidator),
  pendingChangeTimestamp: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const creditTransactionValidator = v.object({
  _id: v.id("creditTransactions"),
  _creationTime: v.number(),
  creditsId: v.id("credits"),
  userId: v.optional(v.id("users")),
  type: creditTransactionTypeValidator,
  creditType: v.union(v.literal("free"), v.literal("paid")),
  amount: v.number(),
  balanceAfter: v.number(),
  description: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.string())),
  stripeInvoiceId: v.optional(v.string()),
  stripePaymentIntentId: v.optional(v.string()),
  stripeChargeId: v.optional(v.string()),
  createdAt: v.number(),
});
