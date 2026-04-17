import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

/**
 * Seed a minimal extraction job with papers and results for stats testing.
 * Returns IDs needed for verification.
 */
async function seedJobWithPapers(
  t: ReturnType<typeof convexTest>,
  paperCount: number,
  questionsPerPaper: {
    questionKey: string;
    answer: string | boolean | number | string[] | null;
    confidence?: number;
    citationStatus: "grounded" | "best_effort" | "insufficient_evidence" | "extraction_error";
  }[]
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

    await ctx.db.insert("credits", {
      userId,
      freeBalance: 0,
      paidBalance: 1000,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });

    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      sourceType: "history" as const,
      status: "extracting" as const,
      totalPapers: paperCount,
      processedPapers: 0,
      failedPapers: 0,
      name: "Stats Test Job",
      createdAt: now,
      updatedAt: now,
    });

    // Create papers
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

  return { ...ids, questionsPerPaper };
}

describe("extractionJobStats upsert", () => {
  it("creates stats rows after completing 3 papers with 2 questions each", async () => {
    const t = convexTest(schema);

    const { jobId, paperIds } = await seedJobWithPapers(t, 3, [
      { questionKey: "sample_size", answer: "100", confidence: 0.92, citationStatus: "grounded" },
      { questionKey: "method", answer: "RCT", confidence: 0.55, citationStatus: "best_effort" },
    ]);

    // Complete each paper via saveExtractionResultsAndComplete
    for (const paperId of paperIds) {
      await t.mutation(internal.extraction.mutations.results.saveExtractionResultsAndComplete, {
        paperId,
        results: [
          {
            questionKey: "sample_size",
            answer: "100",
            confidence: 0.92,
            reasoning: "Found in abstract",
            citations: [],
            citationStatus: "grounded" as const,
          },
          {
            questionKey: "method",
            answer: "RCT",
            confidence: 0.55,
            reasoning: "Mentioned in methods",
            citations: [],
            citationStatus: "best_effort" as const,
          },
        ],
        creditsUsed: 1,
        pdfContentUsed: false,
      });
    }

    // Verify stats rows
    await t.run(async (ctx) => {
      const stats = await ctx.db
        .query("extractionJobStats")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();

      expect(stats).toHaveLength(2); // one per question

      const sampleStat = stats.find((s) => s.questionKey === "sample_size");
      expect(sampleStat).toBeDefined();
      expect(sampleStat!.totalPapers).toBe(3);
      expect(sampleStat!.totalAnswered).toBe(3);
      expect(sampleStat!.groundedCount).toBe(3);
      expect(sampleStat!.bestEffortCount).toBe(0);

      const methodStat = stats.find((s) => s.questionKey === "method");
      expect(methodStat).toBeDefined();
      expect(methodStat!.totalPapers).toBe(3);
      expect(methodStat!.totalAnswered).toBe(3);
      expect(methodStat!.groundedCount).toBe(0);
      expect(methodStat!.bestEffortCount).toBe(3);
    });
  });

  it("classifies confidence buckets correctly (high/medium/low/unknown)", async () => {
    const t = convexTest(schema);

    const { jobId, paperIds } = await seedJobWithPapers(t, 4, []);

    // Paper 0: high confidence (0.92 >= 0.8)
    await t.mutation(internal.extraction.mutations.results.saveExtractionResultsAndComplete, {
      paperId: paperIds[0],
      results: [{
        questionKey: "q1",
        answer: "yes",
        confidence: 0.92,
        reasoning: "",
        citations: [],
        citationStatus: "grounded" as const,
      }],
      creditsUsed: 1,
      pdfContentUsed: false,
    });

    // Paper 1: medium confidence (0.55, 0.5 <= x < 0.8)
    await t.mutation(internal.extraction.mutations.results.saveExtractionResultsAndComplete, {
      paperId: paperIds[1],
      results: [{
        questionKey: "q1",
        answer: "no",
        confidence: 0.55,
        reasoning: "",
        citations: [],
        citationStatus: "best_effort" as const,
      }],
      creditsUsed: 1,
      pdfContentUsed: false,
    });

    // Paper 2: low confidence (0.21, < 0.5)
    await t.mutation(internal.extraction.mutations.results.saveExtractionResultsAndComplete, {
      paperId: paperIds[2],
      results: [{
        questionKey: "q1",
        answer: "maybe",
        confidence: 0.21,
        reasoning: "",
        citations: [],
        citationStatus: "insufficient_evidence" as const,
      }],
      creditsUsed: 1,
      pdfContentUsed: false,
    });

    // Paper 3: unknown confidence (undefined)
    await t.mutation(internal.extraction.mutations.results.saveExtractionResultsAndComplete, {
      paperId: paperIds[3],
      results: [{
        questionKey: "q1",
        answer: null,
        citationStatus: "extraction_error" as const,
        reasoning: "",
        citations: [],
      }],
      creditsUsed: 1,
      pdfContentUsed: false,
    });

    // Verify confidence buckets
    await t.run(async (ctx) => {
      const stat = await ctx.db
        .query("extractionJobStats")
        .withIndex("by_job_question", (q) =>
          q.eq("jobId", jobId).eq("questionKey", "q1"))
        .unique();

      expect(stat).toBeDefined();
      expect(stat!.totalPapers).toBe(4);
      expect(stat!.highConfidenceCount).toBe(1);   // 0.92
      expect(stat!.mediumConfidenceCount).toBe(1);  // 0.55
      expect(stat!.lowConfidenceCount).toBe(1);     // 0.21
      expect(stat!.unknownConfidenceCount).toBe(1); // undefined

      // Confidence sum should only include defined confidences
      expect(stat!.confidenceCount).toBe(3);
      expect(stat!.confidenceSum).toBeCloseTo(0.92 + 0.55 + 0.21);

      // Citation status counts
      expect(stat!.groundedCount).toBe(1);
      expect(stat!.bestEffortCount).toBe(1);
      expect(stat!.insufficientEvidenceCount).toBe(1);
      expect(stat!.extractionErrorCount).toBe(1);

      // Answered: 3 non-null answers (paper 3 has null answer)
      expect(stat!.totalAnswered).toBe(3);
    });
  });

  it("accumulates stats across multiple paper completions (upsert, not overwrite)", async () => {
    const t = convexTest(schema);

    const { jobId, paperIds } = await seedJobWithPapers(t, 2, []);

    // Complete paper 0
    await t.mutation(internal.extraction.mutations.results.saveExtractionResultsAndComplete, {
      paperId: paperIds[0],
      results: [{
        questionKey: "q1",
        answer: "A",
        confidence: 0.9,
        reasoning: "",
        citations: [],
        citationStatus: "grounded" as const,
      }],
      creditsUsed: 1,
      pdfContentUsed: false,
    });

    // Verify after first paper
    await t.run(async (ctx) => {
      const stat = await ctx.db
        .query("extractionJobStats")
        .withIndex("by_job_question", (q) =>
          q.eq("jobId", jobId).eq("questionKey", "q1"))
        .unique();

      expect(stat).toBeDefined();
      expect(stat!.totalPapers).toBe(1);
      expect(stat!.groundedCount).toBe(1);
    });

    // Complete paper 1 -- stats should accumulate, not reset
    await t.mutation(internal.extraction.mutations.results.saveExtractionResultsAndComplete, {
      paperId: paperIds[1],
      results: [{
        questionKey: "q1",
        answer: "B",
        confidence: 0.6,
        reasoning: "",
        citations: [],
        citationStatus: "best_effort" as const,
      }],
      creditsUsed: 1,
      pdfContentUsed: false,
    });

    // Verify accumulation
    await t.run(async (ctx) => {
      const stat = await ctx.db
        .query("extractionJobStats")
        .withIndex("by_job_question", (q) =>
          q.eq("jobId", jobId).eq("questionKey", "q1"))
        .unique();

      expect(stat).toBeDefined();
      expect(stat!.totalPapers).toBe(2); // accumulated
      expect(stat!.totalAnswered).toBe(2);
      expect(stat!.groundedCount).toBe(1); // only first paper
      expect(stat!.bestEffortCount).toBe(1); // only second paper
      expect(stat!.confidenceSum).toBeCloseTo(1.5); // 0.9 + 0.6
      expect(stat!.confidenceCount).toBe(2);
      expect(stat!.highConfidenceCount).toBe(1); // 0.9 >= 0.8
      expect(stat!.mediumConfidenceCount).toBe(1); // 0.6 >= 0.5 < 0.8
    });
  });
});

describe("extractionJobStats cascade delete", () => {
  it("deletes stats rows when job is cascade-deleted", async () => {
    const t = convexTest(schema);

    const { jobId, paperIds } = await seedJobWithPapers(t, 1, []);

    // Complete a paper to create stats
    await t.mutation(internal.extraction.mutations.results.saveExtractionResultsAndComplete, {
      paperId: paperIds[0],
      results: [{
        questionKey: "q1",
        answer: "test",
        confidence: 0.85,
        reasoning: "",
        citations: [],
        citationStatus: "grounded" as const,
      }],
      creditsUsed: 1,
      pdfContentUsed: false,
    });

    // Verify stats exist
    await t.run(async (ctx) => {
      const stats = await ctx.db
        .query("extractionJobStats")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(stats).toHaveLength(1);
    });

    // Cascade delete
    vi.useFakeTimers();
    await t.mutation(
      internal.extraction.mutations.internal.admin.deleteExtractionInternal,
      { jobId }
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    // Verify stats are gone
    await t.run(async (ctx) => {
      const stats = await ctx.db
        .query("extractionJobStats")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(stats).toHaveLength(0);

      // Job itself should be gone
      const job = await ctx.db.get("extractionJobs", jobId);
      expect(job).toBeNull();
    });
  });
});
