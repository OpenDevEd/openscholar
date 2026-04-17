import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

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

describe("finalizeJob terminal-state guard", () => {
  it("does not mutate a cancelled job", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJob(t, "cancelled");

    const before = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    await t.mutation(internal.extraction.mutations.finalizeJob, { jobId });
    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));

    expect(after?.status).toBe("cancelled");
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(after?.completedAt).toBeUndefined();
  });

  it("does not mutate a failed job", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJob(t, "failed");

    const before = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    await t.mutation(internal.extraction.mutations.finalizeJob, { jobId });
    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));

    expect(after?.status).toBe("failed");
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("does not mutate a completed job", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJob(t, "completed");

    const before = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    await t.mutation(internal.extraction.mutations.finalizeJob, { jobId });
    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));

    expect(after?.status).toBe("completed");
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });
});

describe("finalizeJobIfDone terminal-state guard", () => {
  it("does not mutate a cancelled job", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJob(t, "cancelled");

    const before = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    await t.mutation(internal.extraction.mutations.finalizeJobIfDone, { jobId });
    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));

    expect(after?.status).toBe("cancelled");
    expect(after?.updatedAt).toBe(before?.updatedAt);
    expect(after?.completedAt).toBeUndefined();
  });

  it("does not mutate a failed job", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJob(t, "failed");

    const before = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    await t.mutation(internal.extraction.mutations.finalizeJobIfDone, { jobId });
    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));

    expect(after?.status).toBe("failed");
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("does not mutate a completed job", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedJob(t, "completed");

    const before = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    await t.mutation(internal.extraction.mutations.finalizeJobIfDone, { jobId });
    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));

    expect(after?.status).toBe("completed");
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("still finalizes a job in an active state when all papers are done", async () => {
    const t = convexTest(schema);
    const { jobId, paperId } = await seedJob(t, "extracting");

    // Mark the single paper as completed so finalize has work to do
    await t.run(async (ctx) => {
      await ctx.db.patch("extractionPapers", paperId, {
        status: "completed",
        completedAt: Date.now(),
      });
    });

    await t.mutation(internal.extraction.mutations.finalizeJobIfDone, { jobId });

    const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(after?.status).toBe("completed");
    expect(after?.processedPapers).toBe(1);
  });
});

describe("saveExtractionResultsAndComplete terminal-state guard", () => {
  it("does not persist results or finalize when job is cancelled", async () => {
    const t = convexTest(schema);
    const { jobId, paperId } = await seedJob(t, "cancelled");

    await t.mutation(
      internal.extraction.mutations.saveExtractionResultsAndComplete,
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

      const stats = await ctx.db
        .query("extractionJobStats")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
      expect(stats).toHaveLength(0);
    });
  });

  it("persists results normally when job is in an active state", async () => {
    const t = convexTest(schema);
    const { jobId, paperId } = await seedJob(t, "extracting");

    await t.mutation(
      internal.extraction.mutations.saveExtractionResultsAndComplete,
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
    });
  });
});
