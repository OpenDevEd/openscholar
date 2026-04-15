import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import schema from "../schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedUser(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  email: string
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId,
      email,
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastLoginAt: Date.now(),
    });
    return (await ctx.db.get(userId))!;
  });
}

async function seedExtractionJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides: Partial<{
    status: "pending" | "processing" | "completed" | "cancelled" | "failed";
    totalPapers: number;
    processedPapers: number;
    failedPapers: number;
    cancelledPapers: number;
  }> = {}
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      status: overrides.status ?? "pending",
      totalPapers: overrides.totalPapers ?? 5,
      processedPapers: overrides.processedPapers ?? 0,
      failedPapers: overrides.failedPapers ?? 0,
      cancelledPapers: overrides.cancelledPapers ?? 0,
      questions: [
        {
          key: "q1",
          question: "Is methodology sound?",
          expectedType: "boolean",
        },
      ],
      workflowId: "wf_test_123",
      createdAt: now,
      updatedAt: now,
    });
    return jobId;
  });
}

async function seedExtractionPaper(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"extractionJobs">,
  openalexId: string,
  overrides: Partial<{
    status:
      | "pending"
      | "parsing"
      | "extracting"
      | "completed"
      | "failed"
      | "cancelled";
    workpoolId: string;
  }> = {}
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId,
      title: `Paper ${openalexId}`,
      status: overrides.status ?? "pending",
      ...(overrides.workpoolId !== undefined
        ? { workpoolId: overrides.workpoolId }
        : {}),
      createdAt: now,
    });
    return paperId;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cancelExtractionJob", () => {
  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_excancel1", "excancel1@test.com");
    const jobId = await seedExtractionJob(t, user._id);

    // No identity -> should throw UNAUTHENTICATED
    await expect(
      t.mutation(api.extraction.mutations.cancelExtractionJob, { jobId })
    ).rejects.toThrow();
  });

  it("rejects when job not found", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_excancel2", "excancel2@test.com");
    const asUser = t.withIdentity({ subject: "clerk_excancel2" });

    // Create and delete a job to get a valid-shaped but non-existent ID
    const jobId = await seedExtractionJob(t, user._id);
    await t.run(async (ctx) => {
      await ctx.db.delete(jobId);
    });

    await expect(
      asUser.mutation(api.extraction.mutations.cancelExtractionJob, { jobId })
    ).rejects.toThrow();
  });

  it("rejects when job belongs to another user (same error, no info leak)", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_excancel3a", "excancel3a@test.com");
    const user2 = await seedUser(t, "clerk_excancel3b", "excancel3b@test.com");
    const jobId = await seedExtractionJob(t, user1._id);

    const asUser2 = t.withIdentity({ subject: "clerk_excancel3b" });

    await expect(
      asUser2.mutation(api.extraction.mutations.cancelExtractionJob, { jobId })
    ).rejects.toThrow();
  });

  it("cancels a pending job", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_excancel4", "excancel4@test.com");
    const jobId = await seedExtractionJob(t, user._id, { status: "pending" });

    const asUser = t.withIdentity({ subject: "clerk_excancel4" });
    await asUser.mutation(api.extraction.mutations.cancelExtractionJob, {
      jobId,
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("cancelled");
    expect(job!.updatedAt).toBeGreaterThan(0);
  });

  it("cancels a processing job", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_excancel5", "excancel5@test.com");
    const jobId = await seedExtractionJob(t, user._id, {
      status: "processing",
    });

    const asUser = t.withIdentity({ subject: "clerk_excancel5" });
    await asUser.mutation(api.extraction.mutations.cancelExtractionJob, {
      jobId,
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("cancelled");
  });

  it("is idempotent for already-cancelled job (no error, no state change)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_excancel6", "excancel6@test.com");
    const jobId = await seedExtractionJob(t, user._id, {
      status: "cancelled",
    });

    const originalJob = await t.run(async (ctx) => ctx.db.get(jobId));

    const asUser = t.withIdentity({ subject: "clerk_excancel6" });
    // Should not throw
    await asUser.mutation(api.extraction.mutations.cancelExtractionJob, {
      jobId,
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("cancelled");
    // updatedAt should NOT change (idempotent no-op)
    expect(job!.updatedAt).toBe(originalJob!.updatedAt);
  });

  it("is idempotent for completed job (no error, no state change)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_excancel7", "excancel7@test.com");
    const jobId = await seedExtractionJob(t, user._id, {
      status: "completed",
    });

    const asUser = t.withIdentity({ subject: "clerk_excancel7" });
    await asUser.mutation(api.extraction.mutations.cancelExtractionJob, {
      jobId,
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("completed");
  });

  it("is idempotent for failed job (no error, no state change)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_excancel8", "excancel8@test.com");
    const jobId = await seedExtractionJob(t, user._id, { status: "failed" });

    const asUser = t.withIdentity({ subject: "clerk_excancel8" });
    await asUser.mutation(api.extraction.mutations.cancelExtractionJob, {
      jobId,
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("failed");
  });

  it("papers without workpoolId get cancelled status", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_excancel9", "excancel9@test.com");
    const jobId = await seedExtractionJob(t, user._id, {
      status: "processing",
      totalPapers: 2,
    });

    // Create 2 papers without workpoolId (never enqueued)
    const paper1Id = await seedExtractionPaper(t, jobId, "oa:cancel9_1");
    const paper2Id = await seedExtractionPaper(t, jobId, "oa:cancel9_2");

    const asUser = t.withIdentity({ subject: "clerk_excancel9" });
    await asUser.mutation(api.extraction.mutations.cancelExtractionJob, {
      jobId,
    });

    const paper1 = await t.run(async (ctx) => ctx.db.get(paper1Id));
    const paper2 = await t.run(async (ctx) => ctx.db.get(paper2Id));

    expect(paper1!.status).toBe("cancelled");
    expect(paper1!.updatedAt).toBeDefined();
    expect(paper2!.status).toBe("cancelled");
    expect(paper2!.updatedAt).toBeDefined();
  });

  it("cancelledPapers counter matches number of non-terminal papers cancelled", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_excancel10", "excancel10@test.com");
    const jobId = await seedExtractionJob(t, user._id, {
      status: "processing",
      totalPapers: 3,
      processedPapers: 1,
    });

    // 1 completed, 1 pending, 1 parsing -- only pending + parsing should be cancelled
    await seedExtractionPaper(t, jobId, "oa:cancel10_done", {
      status: "completed",
    });
    await seedExtractionPaper(t, jobId, "oa:cancel10_pending", {
      status: "pending",
    });
    await seedExtractionPaper(t, jobId, "oa:cancel10_parsing", {
      status: "parsing",
    });

    const asUser = t.withIdentity({ subject: "clerk_excancel10" });
    await asUser.mutation(api.extraction.mutations.cancelExtractionJob, {
      jobId,
    });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    // Only 2 non-terminal papers (pending + parsing) should be counted
    expect(job!.cancelledPapers).toBe(2);
  });

  it("preserves existing extraction results after cancel", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_excancel11", "excancel11@test.com");
    const jobId = await seedExtractionJob(t, user._id, {
      status: "processing",
      totalPapers: 2,
      processedPapers: 1,
    });

    // One completed paper with results
    const completedPaperId = await seedExtractionPaper(
      t,
      jobId,
      "oa:cancel11_done",
      { status: "completed" }
    );

    // Seed an extraction result for the completed paper
    await t.run(async (ctx) => {
      await ctx.db.insert("extractionResults", {
        jobId,
        paperId: completedPaperId,
        questionId: "q1",
        answer: "yes",
        confidence: "high",
        evidenceQuote: "test quote",
        reasoning: "test reasoning",
        modelUsed: "gemini-3-flash",
        createdAt: Date.now(),
      });
    });

    // One pending paper
    await seedExtractionPaper(t, jobId, "oa:cancel11_pending", {
      status: "pending",
    });

    const asUser = t.withIdentity({ subject: "clerk_excancel11" });
    await asUser.mutation(api.extraction.mutations.cancelExtractionJob, {
      jobId,
    });

    // Extraction result for the completed paper should still exist
    const results = await t.run(async (ctx) => {
      return await ctx.db
        .query("extractionResults")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
    });
    expect(results).toHaveLength(1);
    expect(results[0].answer).toBe("yes");
    expect(results[0].confidence).toBe("high");
  });

  it("already-terminal papers are not re-cancelled", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_excancel12", "excancel12@test.com");
    const jobId = await seedExtractionJob(t, user._id, {
      status: "processing",
      totalPapers: 3,
      processedPapers: 1,
      failedPapers: 1,
    });

    // Create papers in mixed terminal/non-terminal states
    const completedPaperId = await seedExtractionPaper(
      t,
      jobId,
      "oa:cancel12_done",
      { status: "completed" }
    );
    const failedPaperId = await seedExtractionPaper(
      t,
      jobId,
      "oa:cancel12_fail",
      { status: "failed" }
    );
    const pendingPaperId = await seedExtractionPaper(
      t,
      jobId,
      "oa:cancel12_pending",
      { status: "pending" }
    );

    const asUser = t.withIdentity({ subject: "clerk_excancel12" });
    await asUser.mutation(api.extraction.mutations.cancelExtractionJob, {
      jobId,
    });

    const completedPaper = await t.run(async (ctx) =>
      ctx.db.get(completedPaperId)
    );
    const failedPaper = await t.run(async (ctx) => ctx.db.get(failedPaperId));
    const pendingPaper = await t.run(async (ctx) => ctx.db.get(pendingPaperId));

    // Completed paper retains its status
    expect(completedPaper!.status).toBe("completed");
    // Failed paper retains its status
    expect(failedPaper!.status).toBe("failed");
    // Only the pending paper becomes cancelled
    expect(pendingPaper!.status).toBe("cancelled");
  });
});
