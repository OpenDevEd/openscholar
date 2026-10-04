import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import { api } from "../_generated/api";
import { internal } from "../_generated/api";
import schema from "../schema";
import { SEED_IDENTITY, seedFullJobGraph } from "./tests/seed";

describe("deleteExtractionInternal cascade", () => {
  it("deletes full job graph leaving zero orphaned rows", async () => {
    const t = convexTest(schema);

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

    // Verify zero orphaned rows in every child table.
    await t.run(async (ctx) => {
      // 1. Evidence units
      const evidenceUnits = await ctx.db
        .query("extractionEvidenceUnits")
        .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
        .collect();
      expect(evidenceUnits).toHaveLength(0);

      // 2. Results
      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
        .collect();
      expect(results).toHaveLength(0);

      // 3. Paper error history
      const paperErrors = await ctx.db
        .query("extractionPaperErrors")
        .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(paperErrors).toHaveLength(0);

      // 4. Papers
      const papers = await ctx.db
        .query("extractionPapers")
        .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(papers).toHaveLength(0);

      // 5. Queue rows
      const queueRows = await ctx.db
        .query("extractionPaperQueue")
        .withIndex("by_job_and_status", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(queueRows).toHaveLength(0);

      // 6. Questions
      const questions = await ctx.db
        .query("extractionQuestions")
        .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(questions).toHaveLength(0);

      // 7. Source snapshot rows
      const sources = await ctx.db
        .query("extractionJobSources")
        .withIndex("by_job_and_position", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(sources).toHaveLength(0);

      const chatPapers = await ctx.db
        .query("chatPapers")
        .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(chatPapers).toHaveLength(0);

      const chatSourceEvents = await ctx.db
        .query("chatSourceEvents")
        .withIndex("by_job_createdAt", (q) => q.eq("jobId", ids.jobId))
        .collect();
      expect(chatSourceEvents).toHaveLength(0);

      // 8. The job itself
      const job = await ctx.db.get("extractionJobs", ids.jobId);
      expect(job).toBeNull();

      // User should NOT be deleted
      const user = await ctx.db.get("users", ids.userId);
      expect(user).not.toBeNull();
    });
  });

  it("handles job with no child records gracefully", async () => {
    const t = convexTest(schema);
    const now = Date.now();

    // Seed only a user + job (no papers, questions, or anything)
    const { userId, jobId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {libraryItemCount: 0, 
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

        // Results should still exist
        const results = await ctx.db
          .query("extractionResults")
          .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId))
          .collect();
        expect(results.length).toBeGreaterThan(0);
      });

      // Now re-invoke deleteExtractionInternal -- it should skip step 1
      // (no evidence units) and proceed through the remaining steps.
      vi.useFakeTimers();
      await t.mutation(
        internal.extraction.mutations.internal.admin.deleteExtractionInternal,
        { jobId: ids.jobId }
      );
      await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
      vi.useRealTimers();

      // Verify ALL child tables are empty for this job
      await t.run(async (ctx) => {
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

        const paperErrors = await ctx.db
          .query("extractionPaperErrors")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(paperErrors).toHaveLength(0);

        const sourceEvents = await ctx.db
          .query("chatSourceEvents")
          .withIndex("by_job_createdAt", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(sourceEvents).toHaveLength(0);

        const job = await ctx.db.get("extractionJobs", ids.jobId);
        expect(job).toBeNull();
      });
    });

    it("complete deletion leaves no orphaned records in any child table", async () => {
      const t = convexTest(schema);
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

        const paperErrors = await ctx.db
          .query("extractionPaperErrors")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(paperErrors).toHaveLength(0);

        const queueRows = await ctx.db
          .query("extractionPaperQueue")
          .withIndex("by_job_and_status", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(queueRows).toHaveLength(0);

        const sources = await ctx.db
          .query("extractionJobSources")
          .withIndex("by_job_and_position", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(sources).toHaveLength(0);

        const chatPapers = await ctx.db
          .query("chatPapers")
          .withIndex("by_job", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(chatPapers).toHaveLength(0);

        const chatSourceEvents = await ctx.db
          .query("chatSourceEvents")
          .withIndex("by_job_createdAt", (q) => q.eq("jobId", ids.jobId))
          .collect();
        expect(chatSourceEvents).toHaveLength(0);

        // Job itself
        const job = await ctx.db.get("extractionJobs", ids.jobId);
        expect(job).toBeNull();

        // User survives
        const user = await ctx.db.get("users", ids.userId);
        expect(user).not.toBeNull();
      });
    });

    it("re-invocation on already-deleted job is idempotent (no-op)", async () => {
      const t = convexTest(schema);
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

      // Verify nothing crashed and user state is still intact.
      await t.run(async (ctx) => {
        const user = await ctx.db.get("users", ids.userId);
        expect(user).not.toBeNull();
      });
    });
  });

  it("public delete removes the visible job row immediately and schedules cascade cleanup", async () => {
    const t = convexTest(schema);
    const ids = await seedFullJobGraph(t);
    const auth = t.withIdentity(SEED_IDENTITY);

    await auth.mutation(api.extraction.mutations.deleteExtraction, {
      jobId: ids.jobId,
    });

    await t.run(async (ctx) => {
      const job = await ctx.db.get("extractionJobs", ids.jobId);
      const queueRows = await ctx.db
        .query("extractionPaperQueue")
        .withIndex("by_job_and_status", (q) => q.eq("jobId", ids.jobId))
        .collect();
      const scheduledFunctions = await ctx.db.system
        .query("_scheduled_functions")
        .collect();

      expect(job).toBeNull();
      expect(queueRows).toHaveLength(1);
      expect(
        scheduledFunctions.some((sf) =>
          sf.name.includes("deleteExtractionInternal"),
        ),
      ).toBe(true);
    });
  });
});
