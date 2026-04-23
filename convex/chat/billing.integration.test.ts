/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi, beforeEach } from "vitest";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { setupTransactionAggregates } from "../credits/aggregates.test-support";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

async function seedChatBillingState(
  t: ReturnType<typeof convexTest>,
): Promise<{ userId: Id<"users">; jobId: Id<"extractionJobs">; threadId: string }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_chat_billing",
      email: "chat-billing@example.com",
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
      name: "Billing job",
      chatThreadId: "thread_billing",
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, jobId, threadId: "thread_billing" };
  });
}

function generationResponse(
  generationId: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return new Response(
    JSON.stringify({
      data: {
        id: generationId,
        model: "google/gemini-3.1-flash-lite-preview",
        provider_name: "Google AI Studio",
        cancelled: false,
        finish_reason: "stop",
        native_finish_reason: "STOP",
        native_tokens_prompt: 11,
        native_tokens_completion: 7,
        native_tokens_reasoning: 3,
        native_tokens_cached: 0,
        total_cost: 0.25,
        ...overrides,
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

describe("chat generation reconciliation", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("does not double bill a generation already charged from sdk usage", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId, jobId, threadId } = await seedChatBillingState(t);
    const generationId = "gen_sdk_fast_1";

    await t.mutation(internal.chat.billing.captureGenerationFromResponse, {
      threadId,
      generationId,
      requestedModel: "google/gemini-3.1-flash-lite-preview",
    });

    await t.mutation(internal.chat.billing.billGenerationFromSdkUsage, {
      generationId,
      model: "google/gemini-3.1-flash-lite-preview",
      pricing: { input: 0.1, output: 0.4 },
      promptTokens: 30_000,
      completionTokens: 1_000,
      reasoningTokens: 0,
      cachedPromptTokens: 0,
    });

    fetchMock.mockResolvedValue(generationResponse(generationId));

    await t.action(internal.chat.billing.reconcileGenerationUsage, {
      generationId,
    });

    const balance = await t.run(async (ctx) =>
      ctx.runQuery(internal.credits.internal.getBalanceByUserId, { userId }),
    );
    expect(balance?.lifetimeUsed).toBeGreaterThan(0);

    await t.run(async (ctx) => {
      const ledger = await ctx.db
        .query("chatGenerationUsages")
        .withIndex("by_generation_id", (q) => q.eq("generationId", generationId))
        .unique();
      expect(ledger?.status).toBe("billed");
      expect(ledger?.source).toBe("sdk_usage");
      expect(ledger?.jobId).toBe(jobId);

      const txs = await ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(txs).toHaveLength(1);
      expect(txs[0]?.metadata?.generationId).toBe(generationId);
      expect(txs[0]?.metadata?.billingSource).toBe("sdk_usage");
    });
  });

  it("can bill a completed chat directly from sdk usage without a generation id", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId, jobId, threadId } = await seedChatBillingState(t);

    await t.mutation(internal.chat.billing.billThreadUsageFromSdk, {
      threadId,
      model: "google/gemini-3.1-flash-lite-preview",
      pricing: { input: 0.1, output: 0.4 },
      promptTokens: 12_000,
      completionTokens: 500,
      reasoningTokens: 0,
      cachedPromptTokens: 0,
    });

    const balance = await t.run(async (ctx) =>
      ctx.runQuery(internal.credits.internal.getBalanceByUserId, { userId }),
    );
    expect(balance?.lifetimeUsed).toBeGreaterThan(0);

    await t.run(async (ctx) => {
      const txs = await ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(txs).toHaveLength(1);
      expect(txs[0]?.metadata?.billingSource).toBe("sdk_usage");
      expect(txs[0]?.metadata?.generationId).toBeUndefined();
    });
  });

  it("bills a captured generation exactly once across duplicate reconcile calls", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId, jobId, threadId } = await seedChatBillingState(t);
    const generationId = "gen_dedupe_1";

    await t.mutation(internal.chat.billing.captureGenerationFromResponse, {
      threadId,
      generationId,
      requestedModel: "google/gemini-3.1-flash-lite-preview",
    });

    fetchMock.mockResolvedValue(
      generationResponse(generationId, { cancelled: true }),
    );

    await t.action(internal.chat.billing.reconcileGenerationUsage, {
      generationId,
    });
    const firstBalance = await t.run(async (ctx) =>
      ctx.runQuery(internal.credits.internal.getBalanceByUserId, { userId }),
    );

    await t.action(internal.chat.billing.reconcileGenerationUsage, {
      generationId,
    });
    const secondBalance = await t.run(async (ctx) =>
      ctx.runQuery(internal.credits.internal.getBalanceByUserId, { userId }),
    );

    expect(firstBalance?.lifetimeUsed).toBeGreaterThan(0);
    expect(secondBalance?.lifetimeUsed).toBe(firstBalance?.lifetimeUsed);

    await t.run(async (ctx) => {
      const ledger = await ctx.db
        .query("chatGenerationUsages")
        .withIndex("by_generation_id", (q) => q.eq("generationId", generationId))
        .unique();
      expect(ledger?.status).toBe("billed");
      expect(ledger?.jobId).toBe(jobId);

      const txs = await ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(txs).toHaveLength(1);
      expect(txs[0]?.metadata?.generationId).toBe(generationId);
    });
  });

  it("retries a missing generation record and bills once when it appears", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId, threadId } = await seedChatBillingState(t);
    const generationId = "gen_retry_1";

    await t.mutation(internal.chat.billing.captureGenerationFromResponse, {
      threadId,
      generationId,
      requestedModel: "google/gemini-3.1-flash-lite-preview",
    });

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { message: `Generation ${generationId} not found` },
          }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(generationResponse(generationId));

    vi.useFakeTimers();
    await t.action(internal.chat.billing.reconcileGenerationUsage, {
      generationId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const balance = await t.run(async (ctx) =>
      ctx.runQuery(internal.credits.internal.getBalanceByUserId, { userId }),
    );
    expect(balance?.lifetimeUsed).toBeGreaterThan(0);

    await t.run(async (ctx) => {
      const ledger = await ctx.db
        .query("chatGenerationUsages")
        .withIndex("by_generation_id", (q) => q.eq("generationId", generationId))
        .unique();
      expect(ledger?.status).toBe("billed");
      expect(ledger?.attemptCount).toBeGreaterThanOrEqual(2);
    });
  });
});
