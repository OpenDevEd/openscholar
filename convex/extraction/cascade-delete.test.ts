import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { seedFullJobGraph } from "./tests/seed";
import { setupAggregates } from "./aggregates.test-support";

describe("deleteExtractionInternal cascade", () => {
  it("deletes full job graph leaving zero orphaned rows", async () => {
    const t = convexTest(schema);
    setupAggregates(t);

    const ids = await seedFullJobGraph(t);

    // Enable fake timers BEFORE the mutation so scheduled functions
    // can be advanced by finishAllScheduledFunctions
    vi.useFakeTimers();

    // Trigger the cascade delete
    await t.mutation(
      internal.extraction.mutations.internal.admin.deleteExtractionInternal,
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
      const job = await ctx.db.get("extractionJobs", ids.jobId);
      expect(job).toBeNull();

      // Baseline job should NOT be deleted
      const baselineJob = await ctx.db.get("extractionJobs", ids.baselineJobId);
      expect(baselineJob).not.toBeNull();

      // User should NOT be deleted
      const user = await ctx.db.get("users", ids.userId);
      expect(user).not.toBeNull();
    });
  });

  it("deletes diffs where deleted job is the BASELINE (BUG-03 fix)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);

    const ids = await seedFullJobGraph(t);

    // Insert a "reverse" diff: baselineJobId is the primary, jobId is the baseline
    // This simulates a diff where the job we're about to delete is the BASELINE
    const reverseDiffId = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("extractionRunDiffs", {
        jobId: ids.baselineJobId,
        baselineJobId: ids.jobId,
        userId: ids.userId,
        summary: {
          newAnswers: 0,
          changedAnswers: 0,
          removedAnswers: 0,
          confidenceShifts: 0,
          newlyInsufficientEvidence: 0,
          totalCompared: 1,
        },
        changes: [],
        generatedAt: Date.now(),
        createdAt: Date.now(),
      });
    });

    vi.useFakeTimers();

    // Delete the PRIMARY job (ids.jobId) -- which is the BASELINE in the reverse diff
    await t.mutation(
      internal.extraction.mutations.internal.admin.deleteExtractionInternal,
      { jobId: ids.jobId }
    );

    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    await t.run(async (ctx) => {
      // The original diff (jobId: ids.jobId) should be deleted (Step 8)
      const originalDiff = await ctx.db.get("extractionRunDiffs", ids.runDiffId);
      expect(originalDiff).toBeNull();

      // The reverse diff (baselineJobId: ids.jobId) should ALSO be deleted (Step 8b)
      const reverseDiff = await ctx.db.get("extractionRunDiffs", reverseDiffId);
      expect(reverseDiff).toBeNull();

      // The baseline job should still exist (we only deleted ids.jobId)
      const baselineJob = await ctx.db.get("extractionJobs", ids.baselineJobId);
      expect(baselineJob).not.toBeNull();
    });
  });

  it("handles job with no child records gracefully", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
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
        mode: "extraction" as const,
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
      internal.extraction.mutations.internal.admin.deleteExtractionInternal,
      { jobId }
    );

    // Run all scheduled functions to completion
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    // Verify the job is deleted
    await t.run(async (ctx) => {
      const job = await ctx.db.get("extractionJobs", jobId);
      expect(job).toBeNull();

      // User should NOT be deleted
      const user = await ctx.db.get("users", userId);
      expect(user).not.toBeNull();
    });
  });

  describe("partial-failure recovery (TEST-04)", () => {
    it("resumes cascade after partial deletion (evidence units already removed)", async () => {
      const t = convexTest(schema);
    setupAggregates(t);
      const ids = await seedFullJobGraph(t);

      // Simulate partial failure: manually delete only evidence units
      // (as if step 1 completed but the function was interrupted before step 2)
      await t.run(async (ctx) => {
        const units = await ctx.db
          .query("extractionEvidenceUnits")
          .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
          .collect();
        for (const unit of units) {
          await ctx.db.delete("extractionEvidenceUnits", unit._id);
        }
      });

      // Verify evidence units are gone but everything else remains
      await t.run(async (ctx) => {
        const units = await ctx.db
          .query("extractionEvidenceUnits")
          .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
          .collect();
        expect(units).toHaveLength(0);

        // Reviews should still exist
        const reviews = await ctx.db
          .query("extractionResultReviews")
          .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
          .collect();
        expect(reviews.length).toBeGreaterThan(0);
      });

      // Now re-invoke deleteExtractionInternal -- it should skip step 1
      // (no evidence units) and proceed through steps 2-9
      vi.useFakeTimers();
      await t.mutation(
        internal.extraction.mutations.internal.admin.deleteExtractionInternal,
        { jobId: ids.jobId }
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
      vi.useRealTimers();

      // Verify ALL child tables are empty for this job
      await t.run(async (ctx) => {
        const reviews = await ctx.db
          .query("extractionResultReviews")
          .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
          .collect();
        expect(reviews).toHaveLength(0);

        const results = await ctx.db
          .query("extractionResults")
          .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
          .collect();
        expect(results).toHaveLength(0);

        const papers = await ctx.db
          .query("extractionPapers")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(papers).toHaveLength(0);

        const questions = await ctx.db
          .query("extractionQuestions")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(questions).toHaveLength(0);

        const savedViews = await ctx.db
          .query("extractionSavedViews")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(savedViews).toHaveLength(0);

        const snapshots = await ctx.db
          .query("extractionReportSnapshots")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(snapshots).toHaveLength(0);

        const runDiffs = await ctx.db
          .query("extractionRunDiffs")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(runDiffs).toHaveLength(0);

        const job = await ctx.db.get("extractionJobs", ids.jobId);
        expect(job).toBeNull();

        // Baseline job should survive
        const baselineJob = await ctx.db.get("extractionJobs", ids.baselineJobId);
        expect(baselineJob).not.toBeNull();
      });
    });

    it("complete deletion leaves no orphaned records in any child table", async () => {
      const t = convexTest(schema);
    setupAggregates(t);
      const ids = await seedFullJobGraph(t);

      vi.useFakeTimers();
      await t.mutation(
        internal.extraction.mutations.internal.admin.deleteExtractionInternal,
        { jobId: ids.jobId }
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
      vi.useRealTimers();

      // Exhaustive check: query every child table by both jobId and paperId
      await t.run(async (ctx) => {
        // By paperId
        const evidenceUnits = await ctx.db
          .query("extractionEvidenceUnits")
          .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
          .collect();
        expect(evidenceUnits).toHaveLength(0);

        const reviews = await ctx.db
          .query("extractionResultReviews")
          .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
          .collect();
        expect(reviews).toHaveLength(0);

        const results = await ctx.db
          .query("extractionResults")
          .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
          .collect();
        expect(results).toHaveLength(0);

        // By jobId
        const papers = await ctx.db
          .query("extractionPapers")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(papers).toHaveLength(0);

        const questions = await ctx.db
          .query("extractionQuestions")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(questions).toHaveLength(0);

        const savedViews = await ctx.db
          .query("extractionSavedViews")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(savedViews).toHaveLength(0);

        const snapshots = await ctx.db
          .query("extractionReportSnapshots")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(snapshots).toHaveLength(0);

        const runDiffs = await ctx.db
          .query("extractionRunDiffs")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(runDiffs).toHaveLength(0);

        // Job itself
        const job = await ctx.db.get("extractionJobs", ids.jobId);
        expect(job).toBeNull();

        // Baseline job survives
        const baselineJob = await ctx.db.get("extractionJobs", ids.baselineJobId);
        expect(baselineJob).not.toBeNull();

        // User survives
        const user = await ctx.db.get("users", ids.userId);
        expect(user).not.toBeNull();
      });
    });

    it("re-invocation on already-deleted job is idempotent (no-op)", async () => {
      const t = convexTest(schema);
    setupAggregates(t);
      const ids = await seedFullJobGraph(t);

      // First: complete the full cascade deletion
      vi.useFakeTimers();
      await t.mutation(
        internal.extraction.mutations.internal.admin.deleteExtractionInternal,
        { jobId: ids.jobId }
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
      vi.useRealTimers();

      // Verify job is gone
      await t.run(async (ctx) => {
        const job = await ctx.db.get("extractionJobs", ids.jobId);
        expect(job).toBeNull();
      });

      // Second: re-invoke on the same (now deleted) jobId
      // Should complete without errors -- ctx.db.get(jobId) returns null,
      // all child queries return empty, step 9 is a no-op
      vi.useFakeTimers();
      await t.mutation(
        internal.extraction.mutations.internal.admin.deleteExtractionInternal,
        { jobId: ids.jobId }
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
      vi.useRealTimers();

      // Verify nothing crashed and baseline is still intact
      await t.run(async (ctx) => {
        const baselineJob = await ctx.db.get("extractionJobs", ids.baselineJobId);
        expect(baselineJob).not.toBeNull();

        const user = await ctx.db.get("users", ids.userId);
        expect(user).not.toBeNull();
      });
    });
  });
});
