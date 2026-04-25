/**
 * Rate Limiting for Convex Functions
 *
 * Uses convex-helpers token-bucket algorithm backed by the rateLimits table.
 * Mutations call rateLimit(ctx, ...) directly; actions delegate to the
 * `consume` internal mutation via ctx.runMutation.
 */

import { defineRateLimits } from "convex-helpers/server/rateLimit";
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const { checkRateLimit, rateLimit, resetRateLimit } = defineRateLimits({
  "start-extraction": {
    kind: "token bucket",
    rate: 5,
    period: HOUR,
    capacity: 3,
  },
  "api-key-save": {
    kind: "token bucket",
    rate: 5,
    period: MINUTE,
    capacity: 5,
  },
  "checkout-session": {
    kind: "token bucket",
    rate: 3,
    period: MINUTE,
    capacity: 3,
  },
  "wallet-generate": {
    kind: "token bucket",
    rate: 60,
    period: MINUTE,
    capacity: 10,
  },
  "wallet-connect": {
    kind: "token bucket",
    rate: 5,
    period: MINUTE,
    capacity: 3,
  },
  "batch-screening": {
    kind: "token bucket",
    rate: 15,
    period: MINUTE,
    capacity: 15,
  },
});

/**
 * Internal mutation for action endpoints that lack ctx.db.
 * Actions call this via ctx.runMutation(internal.lib.rateLimit.consume, ...).
 * Throws ConvexError with { kind: "RateLimited", name, retryAt } on limit breach.
 */
export const consume = internalMutation({
  args: {
    name: v.union(
      v.literal("start-extraction"),
      v.literal("api-key-save"),
      v.literal("checkout-session"),
      v.literal("wallet-generate"),
      v.literal("wallet-connect"),
      v.literal("batch-screening")
    ),
    key: v.string(),
    count: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await rateLimit(ctx, {
      name: args.name,
      key: args.key,
      count: args.count,
      throws: true,
    });
    return null;
  },
});
