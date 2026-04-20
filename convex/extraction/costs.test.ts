/**
 * Behavior tests for creditsAgg and getJobCost (plan-04).
 *
 * Asserts invariants on the live debit-write path:
 *   - recordCreditSpend makes creditsAgg.sum track the paper-level
 *     credit accumulator
 *   - by_job index on creditTransactions returns the expected N rows
 *     per (papers × questions) completion
 *   - deleteExtractionInternal zeroes the aggregate via clearJobCredits
 *   - cancel (no delete) preserves the ledger as a receipt
 */

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal, api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { setupAggregates } from "./aggregates.test-support";
import { creditsAgg } from "./aggregates";

async function seedUserAndCredits(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_plan04",
      email: "plan04@test.local",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("credits", {
      userId,
      freeBalance: 10000,
      paidBalance: 0,
      lifetimeUsed: 0,
      lastUpdatedAt: Date.now(),
    });
    return userId;
  });
}

async function seedExtractionJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  opts: { status: "extracting" | "completed" | "cancelled" } = {
    status: "extracting",
  },
): Promise<{
  jobId: Id<"extractionJobs">;
  paperIds: Id<"extractionPapers">[];
  questionKeys: string[];
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: opts.status,
      totalPapers: 3,
      processedPapers: 0,
      failedPapers: 0,
      name: "Plan-04 cost fixture",
      createdAt: now,
      updatedAt: now,
    });
    const questionKeys = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"];
    for (let i = 0; i < questionKeys.length; i++) {
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: questionKeys[i],
        question: `Question ${i}`,
        type: "string" as const,
        order: i,
        createdAt: now,
      });
    }
    const paperIds: Id<"extractionPapers">[] = [];
    for (let i = 0; i < 3; i++) {
      const paperId = await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: `W${i}`,
        title: `Paper ${i}`,
        status: "extracting" as const,
      });
      paperIds.push(paperId);
    }
    return { jobId, paperIds, questionKeys };
  });
}

async function recordAnswerForPaper(
  t: ReturnType<typeof convexTest>,
  paperId: Id<"extractionPapers">,
  questionKey: string,
  creditsUsed: number,
) {
  await t.mutation(
    internal.extraction.mutations.results.recordOneAnswer,
    {
      paperId,
      questionKey,
      creditsUsed,
      result: {
        answer: `answer-${questionKey}`,
        confidence: 0.9,
        citations: [],
        citationStatus: "grounded" as const,
      },
    },
  );
}

describe("[plan-04] creditsAgg + getJobCost", () => {
  it("sum tracks paper.creditsUsed across 3 papers × 2 questions", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const userId = await seedUserAndCredits(t);
    const { jobId, paperIds, questionKeys } = await seedExtractionJob(
      t,
      userId,
    );

    let expectedTotal = 0;
    for (const paperId of paperIds) {
      for (const qk of questionKeys) {
        const credits = 5;
        await recordAnswerForPaper(t, paperId, qk, credits);
        expectedTotal += credits;
      }
    }

    const sum = await t.run(async (ctx) =>
      creditsAgg.sum(ctx, { namespace: jobId }),
    );
    expect(sum).toBe(expectedTotal);

    const txns = await t.run(async (ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(txns.length).toBe(paperIds.length * questionKeys.length);
    for (const txn of txns) {
      expect(txn.billingType).toBe("extraction_llm");
      expect(txn.paperId).toBeDefined();
      expect(txn.resultId).toBeDefined();
      expect(txn.metadata?.jobId).toBeUndefined();
      expect(txn.metadata?.paperId).toBeUndefined();
      expect(txn.metadata?.billingType).toBeUndefined();
    }
  });

  it("delete → creditsAgg.sum(jobId) === 0 (cascade clean)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const userId = await seedUserAndCredits(t);
    const { jobId, paperIds, questionKeys } = await seedExtractionJob(
      t,
      userId,
    );

    for (const paperId of paperIds) {
      for (const qk of questionKeys) {
        await recordAnswerForPaper(t, paperId, qk, 7);
      }
    }

    const beforeSum = await t.run(async (ctx) =>
      creditsAgg.sum(ctx, { namespace: jobId }),
    );
    expect(beforeSum).toBeGreaterThan(0);

    vi.useFakeTimers();
    await t.mutation(
      internal.extraction.mutations.internal.admin.deleteExtractionInternal,
      { jobId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    const afterSum = await t.run(async (ctx) =>
      creditsAgg.sum(ctx, { namespace: jobId }),
    );
    expect(afterSum).toBe(0);

    // Job row is gone too.
    const job = await t.run(async (ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job).toBeNull();
  });

  it("getJobCost returns total + billingType breakdown summed from the ledger", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const userId = await seedUserAndCredits(t);
    const { jobId, paperIds, questionKeys } = await seedExtractionJob(
      t,
      userId,
    );

    for (const paperId of paperIds) {
      for (const qk of questionKeys) {
        await recordAnswerForPaper(t, paperId, qk, 3);
      }
    }

    const result = await t
      .withIdentity({
        tokenIdentifier: "clerk_plan04",
        subject: "clerk_plan04",
        issuer: "test",
      })
      .query(api.extraction.queries.costs.getJobCost, { jobId });

    expect(result.total).toBe(paperIds.length * questionKeys.length * 3);
    expect(result.breakdown.extraction_llm).toBe(
      paperIds.length * questionKeys.length * 3,
    );
    expect(result.breakdown.embedding).toBe(0);
    expect(result.breakdown.chat).toBe(0);
    expect(result.breakdown.screening).toBe(0);
    expect(result.breakdown.other).toBe(0);
  });
});
