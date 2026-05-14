/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import schema from "../convex/schema";
import { createUserWithDefaults } from "../convex/lib/userCreation";
import { FREE_SIGNUP_CREDIT_GRANT, PLAN_CONFIG } from "../convex/lib/constants";
import { setupTransactionAggregates } from "../convex/credits/aggregates.test-support";
import { readBalance } from "../convex/credits/balanceCounter";

const FIXED_TIME = new Date("2026-01-15T12:00:00Z").getTime();

describe("createUserWithDefaults", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates user, credits row, signup grant txn, and subscription", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);

    const userId = await t.run(async (ctx) =>
      createUserWithDefaults(ctx, {
        clerkId: "clerk_123",
        email: "test@example.com",
      }),
    );

    await t.run(async (ctx) => {
      const user = await ctx.db.get(userId);
      expect(user).toMatchObject({
        clerkId: "clerk_123",
        email: "test@example.com",
        state: "active",
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME,
        lastLoginAt: FIXED_TIME,
      });

      const credits = await ctx.db
        .query("credits")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      expect(credits).not.toBeNull();
      expect(credits).toMatchObject({ userId, createdAt: FIXED_TIME });

      const txns = await ctx.db
        .query("creditTransactions")
        .withIndex("by_credits", (q) => q.eq("creditsId", credits!._id))
        .collect();
      expect(txns).toHaveLength(1);
      expect(txns[0]).toMatchObject({
        type: "grant",
        creditType: "free",
        amount: FREE_SIGNUP_CREDIT_GRANT,
        createdAt: FIXED_TIME,
      });

      const subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      expect(subscription).toMatchObject({
        userId,
        plan: "free",
        status: "active",
        creditsPerMonth: PLAN_CONFIG.free.creditsPerMonth,
        seats: 1,
        createdAt: FIXED_TIME,
        updatedAt: FIXED_TIME,
      });
    });
  });

  it("seed grant pushes balanceFreeCounter to FREE_SIGNUP_CREDIT_GRANT", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);

    const userId = await t.run(async (ctx) =>
      createUserWithDefaults(ctx, {
        clerkId: "clerk_balance",
        email: "balance@example.com",
      }),
    );

    const balance = await t.run(async (ctx) => {
      const credits = await ctx.db
        .query("credits")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      return readBalance(ctx, credits!._id);
    });

    expect(balance.free).toBe(FREE_SIGNUP_CREDIT_GRANT);
    expect(balance.paid).toBe(0);
    expect(balance.total).toBe(FREE_SIGNUP_CREDIT_GRANT);
  });

  it("returns the userId from the users insert", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);

    const userId = await t.run(async (ctx) =>
      createUserWithDefaults(ctx, {
        clerkId: "clerk_ret",
        email: "ret@example.com",
      }),
    );

    expect(userId).toMatch(/^[a-z0-9]+$/);
  });

  it("passes optional profile fields to users table", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);

    const userId = await t.run(async (ctx) =>
      createUserWithDefaults(ctx, {
        clerkId: "clerk_profile",
        email: "profile@example.com",
        firstName: "Test",
        lastName: "User",
        avatarUrl: "https://example.com/avatar.jpg",
      }),
    );

    await t.run(async (ctx) => {
      const user = await ctx.db.get(userId);
      expect(user).toMatchObject({
        firstName: "Test",
        lastName: "User",
        avatarUrl: "https://example.com/avatar.jpg",
      });
    });
  });

  it("omits undefined optional fields from user insert", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);

    const userId = await t.run(async (ctx) =>
      createUserWithDefaults(ctx, {
        clerkId: "clerk_noopt",
        email: "noopt@example.com",
      }),
    );

    await t.run(async (ctx) => {
      const user = await ctx.db.get(userId);
      expect(user).not.toBeNull();
      expect("firstName" in (user as object)).toBe(false);
      expect("lastName" in (user as object)).toBe(false);
      expect("avatarUrl" in (user as object)).toBe(false);
    });
  });
});
