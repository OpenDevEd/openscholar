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
