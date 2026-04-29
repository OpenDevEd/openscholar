/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { setupTransactionAggregates } from "../credits/aggregates.test-support";

async function seedThreadForBilling(
  t: ReturnType<typeof convexTest>,
): Promise<{
  userId: Id<"users">;
  jobId: Id<"extractionJobs">;
  threadId: string;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_tavily",
      email: "tavily@example.com",
      state: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("credits", {
      userId,
      freeBalance: 10_000,
      paidBalance: 0,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "chat",
      name: "Tavily billing job",
      chatThreadId: "thread_tavily_1",
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, jobId, threadId: "thread_tavily_1" };
  });
}

describe("recordTavilyCost", () => {
  // The convertUsdCostToCredits helper used throughout chat billing
  // applies AI_COST_MARKUP=1.3 then Math.ceil at 10_000 credits/USD.
  // 1 Tavily credit  = $0.008 * 1.3 * 10_000 = 104.0…1 (FP) → ceil → 105 credits
  // 2 Tavily credits = $0.016 * 1.3 * 10_000 = 208.0…3 (FP) → ceil → 209 credits
  // We match the helper's actual output rather than the algebraic
  // ideal so this stays consistent with billGenerationFromSdkUsage.
  const EXPECTED_CREDITS_PER_BASIC_TAVILY_CALL = 105;
  const EXPECTED_CREDITS_PER_ADVANCED_TAVILY_CALL = 209;

  it("deducts the markup-adjusted credit amount for 1 Tavily basic credit", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedThreadForBilling(t);

    await t.mutation(internal.chat.billing.recordTavilyCost, {
      threadId: "thread_tavily_1",
      tavilyCredits: 1,
    });

    const balance = await t.run(async (ctx) =>
      ctx.runQuery(internal.credits.internal.getBalanceByUserId, { userId }),
    );
    expect(balance?.lifetimeUsed).toBe(EXPECTED_CREDITS_PER_BASIC_TAVILY_CALL);
    expect(balance?.total).toBe(10_000 - EXPECTED_CREDITS_PER_BASIC_TAVILY_CALL);
  });

  it("deducts the markup-adjusted credit amount for 2 Tavily advanced credits", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedThreadForBilling(t);

    await t.mutation(internal.chat.billing.recordTavilyCost, {
      threadId: "thread_tavily_1",
      tavilyCredits: 2,
    });

    const balance = await t.run(async (ctx) =>
      ctx.runQuery(internal.credits.internal.getBalanceByUserId, { userId }),
    );
    expect(balance?.lifetimeUsed).toBe(
      EXPECTED_CREDITS_PER_ADVANCED_TAVILY_CALL,
    );
  });

  it("writes a creditTransactions row scoped to the chat job with billingType: 'search'", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { jobId } = await seedThreadForBilling(t);

    await t.mutation(internal.chat.billing.recordTavilyCost, {
      threadId: "thread_tavily_1",
      tavilyCredits: 1,
    });

    await t.run(async (ctx) => {
      const txs = await ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(txs).toHaveLength(1);
      const [row] = txs;
      expect(row.billingType).toBe("search");
      expect(row.type).toBe("usage");
      expect(row.amount).toBe(-EXPECTED_CREDITS_PER_BASIC_TAVILY_CALL);
      expect(row.metadata?.searchEngine).toBe("tavily");
      expect(row.metadata?.tavilyCredits).toBe("1");
    });
  });

  it("accumulates separate transactions across consecutive calls (no implicit dedupe)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { jobId, userId } = await seedThreadForBilling(t);

    await t.mutation(internal.chat.billing.recordTavilyCost, {
      threadId: "thread_tavily_1",
      tavilyCredits: 1,
    });
    await t.mutation(internal.chat.billing.recordTavilyCost, {
      threadId: "thread_tavily_1",
      tavilyCredits: 1,
    });

    const balance = await t.run(async (ctx) =>
      ctx.runQuery(internal.credits.internal.getBalanceByUserId, { userId }),
    );
    expect(balance?.lifetimeUsed).toBe(
      EXPECTED_CREDITS_PER_BASIC_TAVILY_CALL * 2,
    );

    await t.run(async (ctx) => {
      const txs = await ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(txs).toHaveLength(2);
    });
  });

  it("rejects non-positive tavilyCredits", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    await seedThreadForBilling(t);

    await expect(
      t.mutation(internal.chat.billing.recordTavilyCost, {
        threadId: "thread_tavily_1",
        tavilyCredits: 0,
      }),
    ).rejects.toThrow();

    await expect(
      t.mutation(internal.chat.billing.recordTavilyCost, {
        threadId: "thread_tavily_1",
        tavilyCredits: -1,
      }),
    ).rejects.toThrow();
  });

  it("throws when the thread is unknown (no chat job indexed by it)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    await seedThreadForBilling(t);

    await expect(
      t.mutation(internal.chat.billing.recordTavilyCost, {
        threadId: "thread_does_not_exist",
        tavilyCredits: 1,
      }),
    ).rejects.toThrow();
  });
});
