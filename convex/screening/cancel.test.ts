import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { api } from "../_generated/api";
import schema from "../schema";

// Helper: create a user directly in the mock DB
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

// Helper: seed a screening job
async function seedScreeningJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides: Partial<{
    status: "pending" | "processing" | "completed" | "cancelled" | "failed" | "creditsExhausted";
    totalPapers: number;
    processedPapers: number;
    failedPapers: number;
    qualifiedPapers: number;
  }> = {}
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("screeningJobs", {
      userId,
      status: overrides.status ?? "pending",
      totalPapers: overrides.totalPapers ?? 5,
      processedPapers: overrides.processedPapers ?? 0,
      failedPapers: overrides.failedPapers ?? 0,
      qualifiedPapers: overrides.qualifiedPapers ?? 0,
      questions: [{ key: "q1", question: "Is this relevant?" }],
      scoringConfig: {
        rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }],
        starThresholds: [{ minScore: 0, maxScore: 1, stars: 1 }],
      },
      createdAt: now,
      updatedAt: now,
    });
    return jobId;
  });
}

// Helper: seed a screening result linked to a job
async function seedScreeningResult(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"screeningJobs">,
  overrides: Partial<{
    openalexId: string;
    title: string;
    status: "pending" | "processing" | "completed" | "failed" | "skipped";
    answers: Record<string, boolean | null>;
    score: number;
    stars: number;
    qualified: boolean;
  }> = {}
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("screeningResults", {
      jobId,
      openalexId: overrides.openalexId ?? "oa:test1",
      title: overrides.title ?? "Test Paper",
      status: overrides.status ?? "completed",
      ...(overrides.answers !== undefined ? { answers: overrides.answers } : {}),
      ...(overrides.score !== undefined ? { score: overrides.score } : {}),
      ...(overrides.stars !== undefined ? { stars: overrides.stars } : {}),
      ...(overrides.qualified !== undefined ? { qualified: overrides.qualified } : {}),
      createdAt: now,
      completedAt: now,
    });
  });
}

describe("cancelScreeningJob", () => {
  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_cancel1", "cancel1@test.com");
    const jobId = await seedScreeningJob(t, user._id);

    // No identity -> should throw UNAUTHENTICATED
    await expect(
      t.mutation(api.screening.mutations.cancelScreeningJob, { jobId })
    ).rejects.toThrow();
  });

  it("rejects when job not found", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_cancel2", "cancel2@test.com");
    const asUser = t.withIdentity({ subject: "clerk_cancel2" });

    // Create and delete a job to get a valid-shaped but non-existent ID
    const jobId = await seedScreeningJob(t, user._id);
    await t.run(async (ctx) => {
      await ctx.db.delete(jobId);
    });

    await expect(
      asUser.mutation(api.screening.mutations.cancelScreeningJob, { jobId })
    ).rejects.toThrow();
  });

  it("rejects when job belongs to another user (same error, no info leak)", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_cancel3", "cancel3@test.com");
    const user2 = await seedUser(t, "clerk_cancel4", "cancel4@test.com");
    const jobId = await seedScreeningJob(t, user1._id);

    const asUser2 = t.withIdentity({ subject: "clerk_cancel4" });

    await expect(
      asUser2.mutation(api.screening.mutations.cancelScreeningJob, { jobId })
    ).rejects.toThrow();
  });

  it("cancels a pending job", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_cancel5", "cancel5@test.com");
    const jobId = await seedScreeningJob(t, user._id, { status: "pending" });

    const asUser = t.withIdentity({ subject: "clerk_cancel5" });
    await asUser.mutation(api.screening.mutations.cancelScreeningJob, { jobId });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("cancelled");
    expect(job!.updatedAt).toBeGreaterThan(0);
  });

  it("cancels a processing job", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_cancel6", "cancel6@test.com");
    const jobId = await seedScreeningJob(t, user._id, { status: "processing" });

    const asUser = t.withIdentity({ subject: "clerk_cancel6" });
    await asUser.mutation(api.screening.mutations.cancelScreeningJob, { jobId });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("cancelled");
  });

  it("is idempotent for already-cancelled job (no error, no state change)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_cancel7", "cancel7@test.com");
    const jobId = await seedScreeningJob(t, user._id, { status: "cancelled" });

    const originalJob = await t.run(async (ctx) => ctx.db.get(jobId));

    const asUser = t.withIdentity({ subject: "clerk_cancel7" });
    // Should not throw
    await asUser.mutation(api.screening.mutations.cancelScreeningJob, { jobId });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("cancelled");
    // updatedAt should NOT change (idempotent no-op)
    expect(job!.updatedAt).toBe(originalJob!.updatedAt);
  });

  it("is idempotent for completed job (no error, no state change)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_cancel8", "cancel8@test.com");
    const jobId = await seedScreeningJob(t, user._id, { status: "completed" });

    const asUser = t.withIdentity({ subject: "clerk_cancel8" });
    await asUser.mutation(api.screening.mutations.cancelScreeningJob, { jobId });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("completed");
  });

  it("is idempotent for failed job (no error, no state change)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_cancel9", "cancel9@test.com");
    const jobId = await seedScreeningJob(t, user._id, { status: "failed" });

    const asUser = t.withIdentity({ subject: "clerk_cancel9" });
    await asUser.mutation(api.screening.mutations.cancelScreeningJob, { jobId });

    const job = await t.run(async (ctx) => ctx.db.get(jobId));
    expect(job!.status).toBe("failed");
  });

  it("preserves existing screeningResults rows after cancel", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_cancel10", "cancel10@test.com");
    const jobId = await seedScreeningJob(t, user._id, {
      status: "processing",
      totalPapers: 3,
      processedPapers: 2,
      qualifiedPapers: 1,
    });

    // Seed some completed results
    await seedScreeningResult(t, jobId, {
      openalexId: "oa:1",
      title: "Paper 1",
      status: "completed",
      qualified: true,
      score: 1,
    });
    await seedScreeningResult(t, jobId, {
      openalexId: "oa:2",
      title: "Paper 2",
      status: "completed",
      qualified: false,
      score: 0,
    });

    const asUser = t.withIdentity({ subject: "clerk_cancel10" });
    await asUser.mutation(api.screening.mutations.cancelScreeningJob, { jobId });

    // Results should still be queryable
    const results = await t.run(async (ctx) => {
      return await ctx.db
        .query("screeningResults")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect();
    });
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("completed");
    expect(results[1].status).toBe("completed");
  });
});
