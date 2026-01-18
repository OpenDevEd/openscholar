import { v } from "convex/values";

/**
 * Shared validators for reuse across functions
 */

export const ownerTypeValidator = v.union(
  v.literal("user"),
  v.literal("organization")
);

export const roleValidator = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("member")
);

export const planValidator = v.union(
  v.literal("free"),
  v.literal("pro"),
  v.literal("enterprise")
);

export const subscriptionStatusValidator = v.union(
  v.literal("active"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("trialing")
);

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

export const keySourceValidator = v.union(
  v.literal("platform"),
  v.literal("byok")
);

// Full object validators for return types
export const userValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  workosId: v.string(),
  email: v.string(),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
  state: userStateValidator,
  lastLoginAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const creditsValidator = v.object({
  _id: v.id("credits"),
  _creationTime: v.number(),
  ownerId: v.string(),
  ownerType: ownerTypeValidator,
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
  ownerId: v.string(),
  ownerType: ownerTypeValidator,
  stripeSubscriptionId: v.optional(v.string()),
  stripeCustomerId: v.optional(v.string()),
  plan: v.union(planValidator, v.literal("go")), // Include go plan
  status: subscriptionStatusValidator,
  currentPeriodStart: v.optional(v.number()),
  currentPeriodEnd: v.optional(v.number()),
  cancelAtPeriodEnd: v.optional(v.boolean()),
  creditsPerMonth: v.optional(v.number()),
  seats: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});
