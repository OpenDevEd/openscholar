import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../../_generated/api";
import schema from "../../schema";
import type { Id } from "../../_generated/dataModel";
import {
  EXTRACTION_PAPER_CONCURRENCY_BY_PLAN,
  EXTRACTION_QUESTION_CONCURRENCY_BY_PLAN,
  PAPER_LIMIT_BY_PLAN,
  PAPER_LIMIT_MAX,
  assertBucketWithinLimits,
} from "./limits";
import type { EffectiveCountItem } from "../../../lib/bucket/effective-paper-count";

async function seedUser(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("users", {
      clerkId,
      email: `${clerkId}@test.com`,
      firstName: "T",
      lastName: "U",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
  });
}

async function seedPlan(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  plan: "free" | "go" | "pro",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("billingAccounts", {
      userId,
      plan,
      pastDue: false,
      balance: 0,
      purchased: 0,
      signupGranted: true,
      hasPaid: plan !== "free",
      refreshedAt: Date.now(),
    });
  });
}

describe("convex/extraction/bucket/limits", () => {
  it("exposes a plan-keyed map and a derived ceiling", () => {
    expect(PAPER_LIMIT_BY_PLAN.free).toBe(1000);
    expect(PAPER_LIMIT_BY_PLAN.go).toBe(1000);
    expect(PAPER_LIMIT_BY_PLAN.pro).toBe(1000);
    expect(PAPER_LIMIT_MAX).toBe(
      Math.max(...Object.values(PAPER_LIMIT_BY_PLAN)),
    );
  });

  it("returns the free-plan limit when a user has no billing account", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_nopaper_free");
    const limit: number = await t.query(
      internal.extraction.bucket.limits.getPaperLimitForUser,
      { userId },
    );
    expect(limit).toBe(PAPER_LIMIT_BY_PLAN.free);
  });

  it("returns the pro-plan limit for a user on Pro", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_pro");
    await seedPlan(t, userId, "pro");
    const limit: number = await t.query(
      internal.extraction.bucket.limits.getPaperLimitForUser,
      { userId },
    );
    expect(limit).toBe(PAPER_LIMIT_BY_PLAN.pro);
  });



  it("resolves extraction execution limits to plan-derived concurrency knobs", async () => {
    const t = convexTest(schema);
    for (const plan of ["free", "go", "pro"] as const) {
      const userId = await seedUser(t, `clerk_${plan}_limits`);
      if (plan !== "free") {
        await seedPlan(t, userId, plan);
      }

      const limits = await t.query(
        internal.extraction.bucket.limits.getExtractionExecutionLimitsForUser,
        { userId },
      );
      expect(limits.paperConcurrency).toBe(
        EXTRACTION_PAPER_CONCURRENCY_BY_PLAN[plan],
      );
      expect(limits.questionConcurrencyPerPaper).toBe(
        EXTRACTION_QUESTION_CONCURRENCY_BY_PLAN[plan],
      );
      expect(limits.paperConcurrency).toBe(5);
      expect(limits.questionConcurrencyPerPaper).toBe(5);
    }
  });
});

/**
 * `assertBucketWithinLimits` is the single pre-flight gate every
 * mutation that accepts user-staged sources runs through. These tests
 * pin the two bypass scenarios the validator exists to block.
 */
describe("assertBucketWithinLimits", () => {
  function historyRow(limit: number): EffectiveCountItem {
    return { source: "history", searchFilters: { limit } };
  }
  function libraryRow(): EffectiveCountItem {
    return { source: "library" };
  }

  it("accepts a small honest bucket", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_assert_ok");
    const result = await t.run((ctx) =>
      assertBucketWithinLimits(ctx, userId, [
        libraryRow(),
        historyRow(50),
      ]),
    );
    expect(result.effectiveCount).toBe(51);
    expect(result.paperLimit).toBe(PAPER_LIMIT_BY_PLAN.free);
    expect(result.pullCap).toBe(200);
  });

  it("rejects a single placeholder whose limit exceeds the per-row pull cap", async () => {
    // Row count is 1 — old check passed. New check rejects because
    // searchFilters.limit (9999) > pullCap (200).
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_assert_pull");
    await expect(
      t.run((ctx) =>
        assertBucketWithinLimits(ctx, userId, [historyRow(9999)]),
      ),
    ).rejects.toThrow(/per-row pull cap/);
  });

  it("rejects N placeholders whose post-expansion sum exceeds the plan cap", async () => {
    // 10 history rows × 200 papers each = 2000 effective papers.
    // Free plan cap is 1000; old check (rows ≤ 1000) passed. New check
    // measures 2000 > 1000 and rejects.
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_assert_sum");
    const items = Array.from({ length: 10 }, () => historyRow(200));
    await expect(
      t.run((ctx) => assertBucketWithinLimits(ctx, userId, items)),
    ).rejects.toThrow(/exceeding plan limit/);
  });

  it("regression: 1 placeholder + limit=200 stays under cap when alone", async () => {
    // Five rows × 200 = 1000 effective, exactly the free-plan cap.
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_assert_edge");
    const items = Array.from({ length: 5 }, () => historyRow(200));
    const result = await t.run((ctx) =>
      assertBucketWithinLimits(ctx, userId, items),
    );
    expect(result.effectiveCount).toBe(1000);
  });

  it("counts non-history rows as 1 each, even when bucket has many of them", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_assert_lib");
    const items = Array.from({ length: 999 }, () => libraryRow());
    const result = await t.run((ctx) =>
      assertBucketWithinLimits(ctx, userId, items),
    );
    expect(result.effectiveCount).toBe(999);
  });

  it("rejects an empty bucket", async () => {
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_assert_empty");
    await expect(
      t.run((ctx) => assertBucketWithinLimits(ctx, userId, [])),
    ).rejects.toThrow(/at least one paper/);
  });

  it("rejects a bucket whose every history row has limit <= 0", async () => {
    // Every row contributes 0 effective papers. Without the count===0
    // guard, this bucket would start queue setup that would then strand
    // the job in downloading_pdfs/indexing when its loop skipped every
    // source and threw "No sources selected" post-status-transition.
    const t = convexTest(schema);
    const userId = await seedUser(t, "clerk_assert_zerosum");
    await expect(
      t.run((ctx) =>
        assertBucketWithinLimits(ctx, userId, [historyRow(0), historyRow(-5)]),
      ),
    ).rejects.toThrow(/at least one paper/);
  });
});
