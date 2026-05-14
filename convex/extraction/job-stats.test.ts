import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { setupAggregates } from "./aggregates.test-support";
import {
  setupTransactionAggregates,
  seedCreditsForTest,
} from "../credits/aggregates.test-support";
import { readAggregateCounters } from "./aggregates";

type LegacyResultRow = {
  questionKey: string;
  answer: string | boolean | number | string[] | null;
  confidence?: number;
  reasoning?: string;
  citations?: Array<{
    evidenceId: string;
    page: number;
    charRange: number[];
    quote: string;
    retrieval: {
      denseScore?: number;
      lexicalScore?: number;
      fusedScore?: number;
      rerankScore?: number;
    };
    validated: boolean;
  }>;
  citationStatus: "grounded" | "best_effort" | "insufficient_evidence" | "extraction_error";
  pdfContentUsed?: boolean;
};

/**
 * Plan-02 shim: the pre-plan-02 `saveExtractionResultsAndComplete`
 * bundled N results + one credit debit + finalize into a single call.
 * The new flow records one result at a time via `recordOneAnswer`, then
 * rolls the paper up with `finalizePaper`. Splitting the legacy-shape
 * bundle here keeps the aggregate counter assertions one-to-one with
 * the pre-plan-02 test body.
 */
async function saveLegacyBundle(
  t: ReturnType<typeof convexTest>,
  paperId: Id<"extractionPapers">,
  results: LegacyResultRow[],
  creditsUsedTotal: number,
): Promise<void> {
  const perQ = results.length > 0 ? creditsUsedTotal / results.length : 0;
  for (const row of results) {
    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswer,
      {
        paperId,
        questionKey: row.questionKey,
        result: {
          answer: row.answer,
          confidence: row.confidence,
          reasoning: row.reasoning,
          citations: row.citations ?? [],
          citationStatus: row.citationStatus,
          pdfContentUsed: row.pdfContentUsed,
        },
        creditsUsed: perQ,
      },
    );
  }
  await t.mutation(
    internal.extraction.mutations.results.finalizePaper,
    { paperId },
  );
}

/**
 * Seed a minimal extraction job with papers for aggregate testing. Each
 * caller also inserts the question rows it needs via extractionQuestions
 * — the cascade-delete path keys the aggregate clear off questions.
 */
async function seedJobWithPapers(
  t: ReturnType<typeof convexTest>,
  paperCount: number,
  questionKeys: string[] = [],
) {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();

    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_stats_test",
      email: "stats@test.com",
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    await seedCreditsForTest(ctx, { userId, free: 0, paid: 1000, now });

    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      totalPapers: paperCount,
      name: "Stats Test Job",
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i < questionKeys.length; i++) {
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: questionKeys[i],
        question: `Q ${questionKeys[i]}`,
        type: "string" as const,
        order: i,
        createdAt: now,
      });
    }

    const paperIds = [];
    for (let i = 0; i < paperCount; i++) {
      const paperId = await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: `oa:test${i}`,
        title: `Test Paper ${i}`,
        status: "pending" as const,
      });
      paperIds.push(paperId);
    }

    return { userId, jobId, paperIds };
  });

  return ids;
}

describe("aggregate counters via recordOneAnswer + finalizePaper", () => {
  it("records counters for 3 papers × 2 questions", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);

    const { jobId, paperIds } = await seedJobWithPapers(t, 3, [
      "sample_size",
      "method",
    ]);

    for (const paperId of paperIds) {
      await saveLegacyBundle(
        t,
        paperId,
        [
          {
            questionKey: "sample_size",
            answer: "100",
            confidence: 0.92,
            reasoning: "Found in abstract",
            citations: [],
            citationStatus: "grounded",
          },
          {
            questionKey: "method",
            answer: "RCT",
            confidence: 0.55,
            reasoning: "Mentioned in methods",
            citations: [],
            citationStatus: "best_effort",
          },
        ],
        1,
      );
    }

    const sample = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "sample_size"),
    );
    expect(sample.totalPapers).toBe(3);
    expect(sample.totalAnswered).toBe(3);
    expect(sample.groundedCount).toBe(3);
    expect(sample.bestEffortCount).toBe(0);

    const method = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "method"),
    );
    expect(method.totalPapers).toBe(3);
    expect(method.totalAnswered).toBe(3);
    expect(method.groundedCount).toBe(0);
    expect(method.bestEffortCount).toBe(3);
  });

  it("classifies confidence buckets correctly (high/medium/low/unknown)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);

    const { jobId, paperIds } = await seedJobWithPapers(t, 4, ["q1"]);

    // Paper 0: high confidence (0.92 >= 0.8)
    await saveLegacyBundle(t, paperIds[0], [{
      questionKey: "q1",
      answer: "yes",
      confidence: 0.92,
      reasoning: "",
      citations: [],
      citationStatus: "grounded",
    }], 1);

    // Paper 1: medium confidence (0.55, 0.5 <= x < 0.8)
    await saveLegacyBundle(t, paperIds[1], [{
      questionKey: "q1",
      answer: "no",
      confidence: 0.55,
      reasoning: "",
      citations: [],
      citationStatus: "best_effort",
    }], 1);

    // Paper 2: low confidence (0.21, < 0.5)
    await saveLegacyBundle(t, paperIds[2], [{
      questionKey: "q1",
      answer: "maybe",
      confidence: 0.21,
      reasoning: "",
      citations: [],
      citationStatus: "insufficient_evidence",
    }], 1);

    // Paper 3: unknown confidence (undefined)
    await saveLegacyBundle(t, paperIds[3], [{
      questionKey: "q1",
      answer: null,
      citationStatus: "extraction_error",
      reasoning: "",
      citations: [],
    }], 1);

    const c = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "q1"),
    );
    expect(c.totalPapers).toBe(4);
    expect(c.highConfidenceCount).toBe(1);
    expect(c.mediumConfidenceCount).toBe(1);
    expect(c.lowConfidenceCount).toBe(1);
    expect(c.unknownConfidenceCount).toBe(1);
    expect(c.confidenceCount).toBe(3);
    expect(c.confidenceSum).toBeCloseTo(0.92 + 0.55 + 0.21);
    expect(c.groundedCount).toBe(1);
    expect(c.bestEffortCount).toBe(1);
    expect(c.insufficientEvidenceCount).toBe(1);
    expect(c.extractionErrorCount).toBe(1);
    expect(c.totalAnswered).toBe(3);
  });

  it("accumulates counters across multiple paper completions", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);

    const { jobId, paperIds } = await seedJobWithPapers(t, 2, ["q1"]);

    await saveLegacyBundle(t, paperIds[0], [{
      questionKey: "q1",
      answer: "A",
      confidence: 0.9,
      reasoning: "",
      citations: [],
      citationStatus: "grounded",
    }], 1);

    const afterFirst = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "q1"),
    );
    expect(afterFirst.totalPapers).toBe(1);
    expect(afterFirst.groundedCount).toBe(1);

    await saveLegacyBundle(t, paperIds[1], [{
      questionKey: "q1",
      answer: "B",
      confidence: 0.6,
      reasoning: "",
      citations: [],
      citationStatus: "best_effort",
    }], 1);

    const afterSecond = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "q1"),
    );
    expect(afterSecond.totalPapers).toBe(2);
    expect(afterSecond.totalAnswered).toBe(2);
    expect(afterSecond.groundedCount).toBe(1);
    expect(afterSecond.bestEffortCount).toBe(1);
    expect(afterSecond.confidenceSum).toBeCloseTo(1.5);
    expect(afterSecond.confidenceCount).toBe(2);
    expect(afterSecond.highConfidenceCount).toBe(1);
    expect(afterSecond.mediumConfidenceCount).toBe(1);
  });
});

describe("aggregate counters cascade delete", () => {
  it("clears the aggregate when the job is cascade-deleted", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);

    const { jobId, paperIds } = await seedJobWithPapers(t, 1, ["q1"]);

    await saveLegacyBundle(t, paperIds[0], [{
      questionKey: "q1",
      answer: "test",
      confidence: 0.85,
      reasoning: "",
      citations: [],
      citationStatus: "grounded",
    }], 1);

    const before = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "q1"),
    );
    expect(before.totalPapers).toBe(1);

    vi.useFakeTimers();
    await t.mutation(
      internal.extraction.mutations.internal.admin.deleteExtractionInternal,
      { jobId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    const after = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "q1"),
    );
    expect(after.totalPapers).toBe(0);

    await t.run(async (ctx) => {
      const job = await ctx.db.get("extractionJobs", jobId);
      expect(job).toBeNull();
    });
  });
});
