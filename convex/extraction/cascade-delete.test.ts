import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

/**
 * Seed a full extraction job graph across all 9 child tables.
 * Returns all IDs for verification after cascade delete.
 */
async function seedFullJobGraph(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();

    // 1. User
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_cascade_test",
      email: "cascade@test.com",
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    // 2. Primary extraction job (the one we will delete)
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      sourceType: "history" as const,
      status: "completed" as const,
      totalPapers: 1,
      processedPapers: 1,
      failedPapers: 0,
      name: "Test Job",
      createdAt: now,
      updatedAt: now,
    });

    // 3. Baseline job (for runDiffs -- should NOT be deleted)
    const baselineJobId = await ctx.db.insert("extractionJobs", {
      userId,
      sourceType: "history" as const,
      status: "completed" as const,
      totalPapers: 1,
      processedPapers: 1,
      failedPapers: 0,
      name: "Baseline Job",
      createdAt: now,
      updatedAt: now,
    });

    // 4. Extraction question
    const questionId = await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "Test question?",
      type: "string" as const,
      order: 0,
      createdAt: now,
    });

    // 5. Extraction paper (with storageId if possible)
    let storageId: any = undefined;
    try {
      storageId = await ctx.storage.store(
        new Blob(["test pdf content"])
      );
    } catch {
      // ctx.storage.store may not be available in convex-test;
      // cascade handles missing storage gracefully via try/catch
    }

    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:test1",
      title: "Test Paper",
      status: "completed" as const,
      ...(storageId ? { storageId } : {}),
    });

    // 6. Extraction result
    const resultId = await ctx.db.insert("extractionResults", {
      paperId,
      questionKey: "q1",
      answer: "Test answer",
      citations: [],
      citationStatus: "grounded" as const,
      processedAt: now,
    });

    // 7. Extraction result review
    const reviewId = await ctx.db.insert("extractionResultReviews", {
      jobId,
      paperId,
      resultId,
      questionKey: "q1",
      state: "unreviewed" as const,
      createdAt: now,
      updatedAt: now,
    });

    // 8. Extraction evidence unit
    const evidenceUnitId = await ctx.db.insert("extractionEvidenceUnits", {
      paperId,
      evidenceId: "ev1",
      page: 1,
      charRange: [0, 100],
      text: "Evidence text",
      tokens: ["evidence", "text"],
      anchorConfidence: 0.95,
      source: "pdf",
      createdAt: now,
    });

    // 9. Extraction saved view
    const savedViewId = await ctx.db.insert("extractionSavedViews", {
      jobId,
      userId,
      name: "Test View",
      filters: {
        searchQuery: "",
        confidenceRange: [0, 1],
        statusFilters: [],
      },
      createdAt: now,
      updatedAt: now,
    });

    // 10. Extraction report snapshot
    const snapshotId = await ctx.db.insert("extractionReportSnapshots", {
      jobId,
      userId,
      name: "Test Report",
      scope: {},
      sections: [],
      metrics: {
        totalPapers: 1,
        answeredRate: 1,
        groundedRate: 1,
        bestEffortRate: 0,
      },
      generatedAt: now,
      createdAt: now,
    });

    // 11. Extraction run diff
    const runDiffId = await ctx.db.insert("extractionRunDiffs", {
      jobId,
      baselineJobId,
      userId,
      summary: {
        newAnswers: 0,
        changedAnswers: 0,
        removedAnswers: 0,
        confidenceShifts: 0,
        newlyInsufficientEvidence: 0,
        totalCompared: 1,
      },
      changes: [],
      generatedAt: now,
      createdAt: now,
    });

    return {
      userId,
      jobId,
      baselineJobId,
      paperId,
      questionId,
      resultId,
      reviewId,
      evidenceUnitId,
      savedViewId,
      snapshotId,
      runDiffId,
      hasStorageId: !!storageId,
    };
  });
}

describe("deleteExtractionInternal cascade", () => {
  it("deletes full job graph leaving zero orphaned rows", async () => {
    const t = convexTest(schema);

    const ids = await seedFullJobGraph(t);

    // Enable fake timers BEFORE the mutation so scheduled functions
    // can be advanced by finishAllScheduledFunctions
    vi.useFakeTimers();

    // Trigger the cascade delete
    await t.mutation(
      internal.extraction.mutations.deleteExtractionInternal,
      { jobId: ids.jobId }
    );

    // Run all scheduled functions to completion (batched cascade)
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    // Verify zero orphaned rows in ALL 9 child tables
    await t.run(async (ctx) => {
      // 1. Evidence units
      const evidenceUnits = await ctx.db
        .query("extractionEvidenceUnits")
        .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
        .collect();
      expect(evidenceUnits).toHaveLength(0);

      // 2. Result reviews
      const reviews = await ctx.db
        .query("extractionResultReviews")
        .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
        .collect();
      expect(reviews).toHaveLength(0);

      // 3. Results
      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
        .collect();
      expect(results).toHaveLength(0);

      // 4. Papers
      const papers = await ctx.db
        .query("extractionPapers")
        .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(papers).toHaveLength(0);

      // 5. Questions
      const questions = await ctx.db
        .query("extractionQuestions")
        .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(questions).toHaveLength(0);

      // 6. Saved views
      const savedViews = await ctx.db
        .query("extractionSavedViews")
        .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(savedViews).toHaveLength(0);

      // 7. Report snapshots
      const snapshots = await ctx.db
        .query("extractionReportSnapshots")
        .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(snapshots).toHaveLength(0);

      // 8. Run diffs
      const runDiffs = await ctx.db
        .query("extractionRunDiffs")
        .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(runDiffs).toHaveLength(0);

      // 9. The job itself
      const job = await ctx.db.get(ids.jobId);
      expect(job).toBeNull();

      // Baseline job should NOT be deleted
      const baselineJob = await ctx.db.get(ids.baselineJobId);
      expect(baselineJob).not.toBeNull();

      // User should NOT be deleted
      const user = await ctx.db.get(ids.userId);
      expect(user).not.toBeNull();
    });
  });

  it("handles job with no child records gracefully", async () => {
    const t = convexTest(schema);
    const now = Date.now();

    // Seed only a user + job (no papers, questions, or anything)
    const { userId, jobId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkId: "clerk_empty_job",
        email: "empty@test.com",
        firstName: "Test",
        lastName: "User",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      });

      const jobId = await ctx.db.insert("extractionJobs", {
        userId,
        sourceType: "history" as const,
        status: "completed" as const,
        totalPapers: 0,
        processedPapers: 0,
        failedPapers: 0,
        name: "Empty Job",
        createdAt: now,
        updatedAt: now,
      });

      return { userId, jobId };
    });

    // Enable fake timers before the mutation
    vi.useFakeTimers();

    // Trigger the cascade delete
    await t.mutation(
      internal.extraction.mutations.deleteExtractionInternal,
      { jobId }
    );

    // Run all scheduled functions to completion
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    // Verify the job is deleted
    await t.run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      expect(job).toBeNull();

      // User should NOT be deleted
      const user = await ctx.db.get(userId);
      expect(user).not.toBeNull();
    });
  });
});
