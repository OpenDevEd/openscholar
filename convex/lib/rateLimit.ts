/**
 * Rate Limiting for Convex Functions
 *
 * Uses convex-helpers token-bucket algorithm backed by the rateLimits table.
 * Mutations call rateLimit(ctx, ...) directly; actions delegate to the
 * `consume` internal mutation via ctx.runMutation.
 */

import { defineRateLimits } from "convex-helpers/server/rateLimit";
import { internalMutation } from "./functions";
import { v } from "convex/values";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const { checkRateLimit, rateLimit, resetRateLimit } = defineRateLimits({
  "library-digest": { kind: "token bucket", rate: 3, period: HOUR, capacity: 3 },
  "profile-invitation": { kind: "token bucket", rate: 20, period: HOUR, capacity: 20 },
  "library-invitation": { kind: "token bucket", rate: 20, period: HOUR, capacity: 20 },
  "start-extraction": {
    kind: "token bucket",
    rate: 30,
    period: HOUR,
    capacity: 30,
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
  // Per-user request-frequency cap for interactive batch AI actions.
  // 15/min with a full burst capacity matches the screening reference
  // contract and is permissive enough for paginated dashboards that
  // legitimately fire one batch per page settle, while still gating
  // auto-fire storms (manual-run wedge, language switch loops).
  "batch-screening": {
    kind: "token bucket",
    rate: 15,
    period: MINUTE,
    capacity: 15,
  },
  "batch-translation": {
    kind: "token bucket",
    rate: 15,
    period: MINUTE,
    capacity: 15,
  },
  // Checking a custom domain costs several DNS, certificate and proxy
  // requests, so it is capped three ways: per person, per library, and per
  // domain. The per-domain bucket is the tightest, because repeating the
  // same check learns nothing new.
  "domain-check-user": {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 30,
  },
  "domain-check-library": {
    kind: "token bucket",
    rate: 20,
    period: MINUTE,
    capacity: 20,
  },
  "domain-check-host": {
    kind: "token bucket",
    rate: 6,
    period: MINUTE,
    capacity: 6,
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
      v.literal("batch-screening"),
      v.literal("batch-translation"),
      v.literal("domain-check-user"),
      v.literal("domain-check-library"),
      v.literal("domain-check-host")
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
