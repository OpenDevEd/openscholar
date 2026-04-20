import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { setupAggregates } from "./aggregates.test-support";
import { readAggregateCounters } from "./aggregates";

async function seedJob(
  t: ReturnType<typeof convexTest>,
  jobStatus: "pending" | "extracting" | "cancelled" | "failed" | "completed",
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_finalize_guard",
      email: "fg@test.com",
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
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: jobStatus,
      totalPapers: 1,
      processedPapers: 0,
      failedPapers: 0,
      name: "Finalize Guard Test",
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:fg1",
      title: "Finalize Guard Paper",
      status: "extracting" as const,
    });
    return { userId, jobId, paperId };
  });
}

describe("maybeFinalizeJob terminal-state guard", () => {
  it("does not mutate a cancelled job", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId } = await seedJob(t, "cancelled");

    const before = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    await t.mutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId });
    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));

    expect(after?.status).toBe("cancelled");
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(after?.completedAt).toBeUndefined();
  });

  it("does not mutate a failed job", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId } = await seedJob(t, "failed");

    const before = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    await t.mutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId });
    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));

    expect(after?.status).toBe("failed");
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("does not mutate a completed job", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId } = await seedJob(t, "completed");

    const before = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    await t.mutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId });
    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));

    expect(after?.status).toBe("completed");
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("still finalizes a job in an active state when all papers are done", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedJob(t, "extracting");

    // Simulate the counter bump that markPaperTerminalTx performs whenever a
    // paper reaches a terminal state. maybeFinalizeJob now relies on these
    // counters rather than scanning papers.
    await t.run(async (ctx) => {
      await ctx.db.patch("extractionPapers", paperId, {
        status: "completed",
        completedAt: Date.now(),
      });
      await ctx.db.patch("extractionJobs", jobId, {
        processedPapers: 1,
      });
    });

    await t.mutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId });

    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(after?.status).toBe("completed");
    expect(after?.processedPapers).toBe(1);
  });

  it("fails a job with totalPapers=0 (all sources non-processable)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId } = await seedJob(t, "extracting");

    await t.run(async (ctx) => {
      await ctx.db.patch("extractionJobs", jobId, { totalPapers: 0 });
    });

    await t.mutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId });

    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(after?.status).toBe("failed");
    expect(after?.completedAt).toBeDefined();
  });

  it("performs O(1) reads per call (does not scan papers)", async () => {
    // Seed a job with 50 papers but leave counters at 0 so the function has
    // no reason to transition. A scan-based finalize would touch all 50
    // papers; the counter-based one must not.
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId } = await seedJob(t, "extracting");
    await t.run(async (ctx) => {
      await ctx.db.patch("extractionJobs", jobId, { totalPapers: 50 });
      for (let i = 0; i < 50; i++) {
        await ctx.db.insert("extractionPapers", {
          jobId,
          openalexId: `oa:stress${i}`,
          title: `Paper ${i}`,
          status: "extracting" as const,
        });
      }
    });

    await t.mutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId });

    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    // Still active because counters say we are not done.
    expect(after?.status).toBe("extracting");
  });
});

describe("markPaperTerminalTx counter maintenance", () => {
  it("bumps processedPapers on a successful completion", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedJob(t, "extracting");

    await t.mutation(internal.extraction.mutations.papers.updatePaperStatus, {
      paperId,
      status: "completed",
      completedAt: Date.now(),
    });

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.processedPapers).toBe(1);
    expect(job?.failedPapers).toBe(0);
  });

  it("bumps failedPapers on a download_failed transition", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedJob(t, "extracting");

    await t.mutation(internal.extraction.mutations.papers.updatePaperStatus, {
      paperId,
      status: "download_failed",
      error: { code: "pdf_invalid", message: "no pdf" },
    });

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.processedPapers).toBe(0);
    expect(job?.failedPapers).toBe(1);
  });

  it("is idempotent: a second terminal transition does not double-count", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedJob(t, "extracting");

    await t.mutation(internal.extraction.mutations.papers.updatePaperStatus, {
      paperId,
      status: "failed",
    });
    await t.mutation(internal.extraction.mutations.papers.updatePaperStatus, {
      paperId,
      status: "failed",
    });

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.failedPapers).toBe(1);
  });

  it("does not bump counters for non-processable papers", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedJob(t, "extracting");

    await t.run(async (ctx) => {
      await ctx.db.patch("extractionPapers", paperId, { processable: false });
      await ctx.db.patch("extractionJobs", jobId, { totalPapers: 0 });
    });

    await t.mutation(internal.extraction.mutations.papers.updatePaperStatus, {
      paperId,
      status: "download_failed",
    });

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.processedPapers).toBe(0);
    expect(job?.failedPapers).toBe(0);
  });
});

describe("saveExtractionResultsAndComplete terminal-state guard", () => {
  it("does not persist results or finalize when job is cancelled", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedJob(t, "cancelled");

    await t.mutation(
      internal.extraction.mutations.results.saveExtractionResultsAndComplete,
      {
        paperId,
        results: [
          {
            questionKey: "q1",
            answer: "A",
            confidence: 0.9,
            reasoning: "r",
            citations: [],
            citationStatus: "grounded" as const,
          },
        ],
        creditsUsed: 1,
        pdfContentUsed: false,
      },
    );

    await t.run(async (ctx) => {
      const job = await ctx.db.get("extractionJobs", jobId);
      expect(job?.status).toBe("cancelled");

      const paper = await ctx.db.get("extractionPapers", paperId);
      expect(paper?.status).toBe("extracting");
      expect(paper?.creditsUsed).toBeUndefined();

      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paperId))
        .collect();
      expect(results).toHaveLength(0);
    });

    // No aggregate rows either: the terminal-state guard short-circuits
    // before recordResult runs.
    const counters = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "q1"),
    );
    expect(counters.totalPapers).toBe(0);
  });

  it("persists results normally when job is in an active state", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedJob(t, "extracting");

    await t.mutation(
      internal.extraction.mutations.results.saveExtractionResultsAndComplete,
      {
        paperId,
        results: [
          {
            questionKey: "q1",
            answer: "A",
            confidence: 0.9,
            reasoning: "r",
            citations: [],
            citationStatus: "grounded" as const,
          },
        ],
        creditsUsed: 1,
        pdfContentUsed: false,
      },
    );

    await t.run(async (ctx) => {
      const paper = await ctx.db.get("extractionPapers", paperId);
      expect(paper?.status).toBe("completed");
      expect(paper?.creditsUsed).toBe(1);

      const results = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paperId))
        .collect();
      expect(results).toHaveLength(1);

      // Job should also be finalized to completed since the only paper is done
      const job = await ctx.db.get("extractionJobs", jobId);
      expect(job?.status).toBe("completed");
      expect(job?.processedPapers).toBe(1);
    });
  });
});
