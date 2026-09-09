/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import {
  setupTransactionAggregates,
  seedCreditsForTest,
} from "./aggregates.test-support";
import { recordTransactionCounters } from "./aggregates";
import { computeSearchableText } from "../../lib/billing/transactions/search-text";

async function seedUser(
  t: ReturnType<typeof convexTest>,
  suffix: string,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      clerkId: `clerk_prorate_${suffix}`,
      email: `prorate_${suffix}@test.com`,
      firstName: "Pro",
      lastName: "Rate",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
  });
}

async function seedUserWithCredits(
  t: ReturnType<typeof convexTest>,
  suffix: string,
  freeSeed: number,
): Promise<{ userId: Id<"users">; creditsId: Id<"credits"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: `clerk_prorate_${suffix}`,
      email: `prorate_${suffix}@test.com`,
      firstName: "Pro",
      lastName: "Rate",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const creditsId = await seedCreditsForTest(ctx, {
      userId,
      free: freeSeed,
      now,
    });
    return { userId, creditsId };
  });
}

async function insertProRataLikeGrant(
  t: ReturnType<typeof convexTest>,
  args: {
    userId: Id<"users">;
    creditsId: Id<"credits">;
    amount: number;
    fromPlan: "free" | "go" | "pro" | "enterprise";
    toPlan: "free" | "go" | "pro" | "enterprise";
    createdAt: number;
    description?: string;
    stripeSubscriptionId?: string;
  },
): Promise<void> {
  await t.run(async (ctx) => {
    const description = args.description ?? "Existing upgrade pro-rata grant";
    const txId = await ctx.db.insert("creditTransactions", {
      creditsId: args.creditsId,
      userId: args.userId,
      type: "grant",
      creditType: "free",
      amount: args.amount,
      description,
      metadata: {
        grantType: "upgrade_prorate",
        fromPlan: args.fromPlan,
        toPlan: args.toPlan,
        stripeSubscriptionId: args.stripeSubscriptionId ?? "sub_seed",
      },
      createdAt: args.createdAt,
      searchableText: computeSearchableText({ description, type: "grant" }),
    });
    await recordTransactionCounters(ctx, {
      _id: txId,
      creditsId: args.creditsId,
      type: "grant",
      creditType: "free",
      amount: args.amount,
      createdAt: args.createdAt,
    });
  });
}

describe("grantUpgradeProRataCredits", () => {
  it("R1: ignores noise transactions before currentPeriodStartMs and grants for the upgrade", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId, creditsId } = await seedUserWithCredits(t, "r1", 100);

    const periodStart = Date.now();
    const periodEnd = periodStart + 30 * 24 * 60 * 60 * 1000;
    const prePeriod = periodStart - 60 * 60 * 1000;

    // 500 noise rows BEFORE the current period that would all match the dedup
    // signature if the scan were unbounded. Bounded scan must ignore them.
    await t.run(async (ctx) => {
      for (let i = 0; i < 500; i++) {
        const description = `Noise grant ${i}`;
        const txId = await ctx.db.insert("creditTransactions", {
          creditsId,
          userId,
          type: "grant",
          creditType: "free",
          amount: 1,
          description,
          metadata: {
            grantType: "upgrade_prorate",
            fromPlan: "go",
            toPlan: "pro",
            stripeSubscriptionId: "sub_noise",
          },
          createdAt: prePeriod - i,
          searchableText: computeSearchableText({ description, type: "grant" }),
        });
        await recordTransactionCounters(ctx, {
          _id: txId,
          creditsId,
          type: "grant",
          creditType: "free",
          amount: 1,
          createdAt: prePeriod - i,
        });
      }
    });

    const result = await t.mutation(
      internal.credits.internal.grantUpgradeProRataCredits,
      {
        userId,
        fromPlan: "go",
        toPlan: "pro",
        currentPeriodStartMs: periodStart,
        currentPeriodEndMs: periodEnd,
        stripeSubscriptionId: "sub_test_r1",
      },
    );

    expect(result.outcome).toBe("granted");
    expect(result.grantedCredits).toBeGreaterThan(0);
  }, 15_000); // Building all 500 ledger rows and aggregate counters can exceed 5s in CI.

  it("R2: returns already_granted when a matching upgrade_prorate exists inside the current period", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId, creditsId } = await seedUserWithCredits(t, "r2", 100);

    const periodStart = Date.now();
    const periodEnd = periodStart + 30 * 24 * 60 * 60 * 1000;

    await insertProRataLikeGrant(t, {
      userId,
      creditsId,
      amount: 6_000,
      fromPlan: "go",
      toPlan: "pro",
      createdAt: periodStart + 1_000,
      stripeSubscriptionId: "sub_existing",
    });

    const result = await t.mutation(
      internal.credits.internal.grantUpgradeProRataCredits,
      {
        userId,
        fromPlan: "go",
        toPlan: "pro",
        currentPeriodStartMs: periodStart,
        currentPeriodEndMs: periodEnd,
        stripeSubscriptionId: "sub_test_r2",
      },
    );

    expect(result.outcome).toBe("already_granted");
    expect(result.grantedCredits).toBe(0);
  });

  it("R3: grants when only non-matching grants exist inside the current period", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId, creditsId } = await seedUserWithCredits(t, "r3", 100);

    const periodStart = Date.now();
    const periodEnd = periodStart + 30 * 24 * 60 * 60 * 1000;

    // Different fromPlan — must not match dedup
    await insertProRataLikeGrant(t, {
      userId,
      creditsId,
      amount: 6_000,
      fromPlan: "free",
      toPlan: "pro",
      createdAt: periodStart + 1_000,
      description: "Different fromPlan upgrade",
      stripeSubscriptionId: "sub_other_from",
    });

    // Different toPlan — must not match dedup
    await insertProRataLikeGrant(t, {
      userId,
      creditsId,
      amount: 1_000,
      fromPlan: "go",
      toPlan: "enterprise",
      createdAt: periodStart + 2_000,
      description: "Different toPlan upgrade",
      stripeSubscriptionId: "sub_other_to",
    });

    // Non-upgrade-prorate grant (regular monthly) — must not match dedup
    await t.run(async (ctx) => {
      const description = "Regular monthly grant inside period";
      const txId = await ctx.db.insert("creditTransactions", {
        creditsId,
        userId,
        type: "grant",
        creditType: "free",
        amount: 3_000,
        description,
        createdAt: periodStart + 3_000,
        searchableText: computeSearchableText({ description, type: "grant" }),
      });
      await recordTransactionCounters(ctx, {
        _id: txId,
        creditsId,
        type: "grant",
        creditType: "free",
        amount: 3_000,
        createdAt: periodStart + 3_000,
      });
    });

    const result = await t.mutation(
      internal.credits.internal.grantUpgradeProRataCredits,
      {
        userId,
        fromPlan: "go",
        toPlan: "pro",
        currentPeriodStartMs: periodStart,
        currentPeriodEndMs: periodEnd,
        stripeSubscriptionId: "sub_test_r3",
      },
    );

    expect(result.outcome).toBe("granted");
    expect(result.grantedCredits).toBeGreaterThan(0);
  });

  it("R3b: grants when there are no existing transactions for the user", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const userId = await seedUser(t, "r3b");
    // No credits row, no transactions — first-ever grant for this user
    const periodStart = Date.now();
    const periodEnd = periodStart + 30 * 24 * 60 * 60 * 1000;

    const result = await t.mutation(
      internal.credits.internal.grantUpgradeProRataCredits,
      {
        userId,
        fromPlan: "go",
        toPlan: "pro",
        currentPeriodStartMs: periodStart,
        currentPeriodEndMs: periodEnd,
        stripeSubscriptionId: "sub_test_r3b",
      },
    );

    expect(result.outcome).toBe("granted");
    expect(result.grantedCredits).toBeGreaterThan(0);
  });
});
