import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
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
    return (await ctx.db.get("users", userId))!;
  });
}

// Helper: seed a screening job
async function seedScreeningJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  overrides: Partial<{
    status: "processing" | "completed" | "cancelled" | "failed" | "creditsExhausted";
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
      status: overrides.status ?? "processing",
      totalPapers: overrides.totalPapers ?? 10,
      processedPapers: overrides.processedPapers ?? 3,
      failedPapers: overrides.failedPapers ?? 1,
      qualifiedPapers: overrides.qualifiedPapers ?? 2,
      questions: [{ key: "q1", question: "Is this relevant?" }],
      scoringConfig: {
        rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }],
        starThresholds: [{ minScore: 0, stars: 1 }],
      },
      createdAt: now,
      updatedAt: now,
    });
    return jobId;
  });
}

// Helper: seed a screening result
async function seedScreeningResult(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"screeningJobs">,
  overrides: Partial<{
    openalexId: string;
    title: string;
    status: "processing" | "completed" | "failed" | "skipped";
    answers: Record<string, boolean | null>;
    score: number;
    stars: number;
    qualified: boolean;
    authors: string[];
    publicationYear: number;
    doi: string;
  }> = {}
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("screeningResults", {
      jobId,
      openalexId: overrides.openalexId ?? "https://openalex.org/W123",
      title: overrides.title ?? "Test Paper",
      status: overrides.status ?? "completed",
      answers: overrides.answers ?? { q1: true },
      score: overrides.score ?? 1,
      stars: overrides.stars ?? 3,
      qualified: overrides.qualified ?? true,
      authors: overrides.authors,
      publicationYear: overrides.publicationYear,
      doi: overrides.doi,
      createdAt: Date.now(),
    });
  });
}

describe("getScreeningResultsForExport", () => {
  it("returns null for unauthenticated calls", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_exp1", "exp1@test.com");
    const jobId = await seedScreeningJob(t, user._id, { status: "completed" });
    await seedScreeningResult(t, jobId);

    // No identity
    const result = await t.query(api.screening.queries.getScreeningResultsForExport, { jobId });
    expect(result).toBeNull();
  });

  it("returns null for non-owner", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_exp2", "exp2@test.com");
    const user2 = await seedUser(t, "clerk_exp3", "exp3@test.com");
    const jobId = await seedScreeningJob(t, user1._id, { status: "completed" });
    await seedScreeningResult(t, jobId);

    const asUser2 = t.withIdentity({ subject: "clerk_exp3" });
    const result = await asUser2.query(api.screening.queries.getScreeningResultsForExport, { jobId });
    expect(result).toBeNull();
  });

  it("returns job metadata and results for authenticated owner", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_exp4", "exp4@test.com");
    const jobId = await seedScreeningJob(t, user._id, { status: "completed" });

    // Seed two results: one fully populated, one minimal
    await seedScreeningResult(t, jobId, {
      openalexId: "https://openalex.org/W100",
      title: "Full Paper",
      status: "completed",
      answers: { q1: true },
      score: 1,
      stars: 3,
      qualified: true,
      authors: ["Author A"],
      publicationYear: 2024,
      doi: "10.1234/test",
    });
    await seedScreeningResult(t, jobId, {
      openalexId: "https://openalex.org/W200",
      title: "Minimal Paper",
      status: "completed",
      answers: { q1: false },
      score: 0,
      stars: 1,
      qualified: false,
    });

    const asUser = t.withIdentity({ subject: "clerk_exp4" });
    const result = await asUser.query(api.screening.queries.getScreeningResultsForExport, { jobId });

    expect(result).not.toBeNull();
    // Job metadata
    expect(result!.job._id).toBe(jobId);
    expect(result!.job.status).toBe("completed");
    expect(result!.job.questions).toHaveLength(1);
    expect(result!.job.scoringConfig).toBeDefined();
    expect(result!.job.totalPapers).toBeDefined();
    expect(result!.job.qualifiedPapers).toBeDefined();
    expect(result!.job.createdAt).toBeDefined();

    // Results
    expect(result!.results).toHaveLength(2);
    const fullResult = result!.results.find((r) => r.openalexId === "https://openalex.org/W100");
    expect(fullResult).toBeDefined();
    expect(fullResult!.title).toBe("Full Paper");
    expect(fullResult!.status).toBe("completed");
    expect(fullResult!.answers).toEqual({ q1: true });
    expect(fullResult!.score).toBe(1);
    expect(fullResult!.stars).toBe(3);
    expect(fullResult!.qualified).toBe(true);
    expect(fullResult!.authors).toEqual(["Author A"]);
    expect(fullResult!.publicationYear).toBe(2024);
    expect(fullResult!.doi).toBe("10.1234/test");
  });

  it("includes failed results with undefined answers", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_exp5", "exp5@test.com");
    const jobId = await seedScreeningJob(t, user._id, { status: "completed" });

    // Seed a failed result without answers/score/stars/qualified
    await t.run(async (ctx) => {
      await ctx.db.insert("screeningResults", {
        jobId,
        openalexId: "https://openalex.org/W999",
        title: "Failed Paper",
        status: "failed",
        createdAt: Date.now(),
      });
    });

    const asUser = t.withIdentity({ subject: "clerk_exp5" });
    const result = await asUser.query(api.screening.queries.getScreeningResultsForExport, { jobId });

    expect(result).not.toBeNull();
    expect(result!.results).toHaveLength(1);
    const failedResult = result!.results[0];
    expect(failedResult.status).toBe("failed");
    expect(failedResult.openalexId).toBe("https://openalex.org/W999");
    expect(failedResult.answers).toBeUndefined();
    expect(failedResult.score).toBeUndefined();
    expect(failedResult.stars).toBeUndefined();
    expect(failedResult.qualified).toBeUndefined();
  });
});

describe("getScreeningProgress", () => {
  it("returns null for unauthenticated calls", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_prog1", "prog1@test.com");
    const jobId = await seedScreeningJob(t, user._id);

    // No identity
    const result = await t.query(api.screening.queries.getScreeningProgress, { jobId });
    expect(result).toBeNull();
  });

  it("returns null for non-existent jobId", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_prog2", "prog2@test.com");
    const asUser = t.withIdentity({ subject: "clerk_prog2" });

    // Create and delete a job to get a valid-shaped but non-existent ID
    const jobId = await seedScreeningJob(t, user._id);
    await t.run(async (ctx) => {
      await ctx.db.delete("screeningJobs", jobId);
    });

    const result = await asUser.query(api.screening.queries.getScreeningProgress, { jobId });
    expect(result).toBeNull();
  });

  it("returns null for another user's job (user isolation)", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_prog3", "prog3@test.com");
    const user2 = await seedUser(t, "clerk_prog4", "prog4@test.com");
    const jobId = await seedScreeningJob(t, user1._id);

    const asUser2 = t.withIdentity({ subject: "clerk_prog4" });
    const result = await asUser2.query(api.screening.queries.getScreeningProgress, { jobId });
    expect(result).toBeNull();
  });

  it("returns correct progress object", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_prog5", "prog5@test.com");
    const jobId = await seedScreeningJob(t, user._id, {
      status: "processing",
      totalPapers: 10,
      processedPapers: 3,
      failedPapers: 1,
      qualifiedPapers: 2,
    });

    const asUser = t.withIdentity({ subject: "clerk_prog5" });
    const result = await asUser.query(api.screening.queries.getScreeningProgress, { jobId });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("processing");
    expect(result!.totalPapers).toBe(10);
    expect(result!.processedPapers).toBe(3);
    expect(result!.failedPapers).toBe(1);
    expect(result!.qualifiedPapers).toBe(2);
    expect(result!.percentComplete).toBe(40); // floor((3+1)/10 * 100) = 40 (includes failedPapers)
  });

  it("percentComplete is 0 when totalPapers is 0", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_prog6", "prog6@test.com");
    const jobId = await seedScreeningJob(t, user._id, {
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      qualifiedPapers: 0,
    });

    const asUser = t.withIdentity({ subject: "clerk_prog6" });
    const result = await asUser.query(api.screening.queries.getScreeningProgress, { jobId });

    expect(result).not.toBeNull();
    expect(result!.percentComplete).toBe(0);
  });

  it("percentComplete floors correctly (e.g., 3/7 papers -> 42%)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_prog7", "prog7@test.com");
    const jobId = await seedScreeningJob(t, user._id, {
      totalPapers: 7,
      processedPapers: 3,
      failedPapers: 0,
      qualifiedPapers: 1,
    });

    const asUser = t.withIdentity({ subject: "clerk_prog7" });
    const result = await asUser.query(api.screening.queries.getScreeningProgress, { jobId });

    expect(result).not.toBeNull();
    expect(result!.percentComplete).toBe(42); // Math.floor(3/7 * 100) = 42
  });

  it("percentComplete capped at 99% while job is still processing", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_prog8", "prog8@test.com");
    // 199/200 = 99.5% — old Math.round would show 100%
    const jobId = await seedScreeningJob(t, user._id, {
      status: "processing",
      totalPapers: 200,
      processedPapers: 199,
      failedPapers: 0,
      qualifiedPapers: 100,
    });

    const asUser = t.withIdentity({ subject: "clerk_prog8" });
    const result = await asUser.query(api.screening.queries.getScreeningProgress, { jobId });

    expect(result).not.toBeNull();
    expect(result!.percentComplete).toBe(99); // Capped — never 100% while processing
  });

  it("percentComplete is 100% when job is in a terminal state", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_prog9", "prog9@test.com");
    const jobId = await seedScreeningJob(t, user._id, {
      status: "completed",
      totalPapers: 10,
      processedPapers: 8,
      failedPapers: 2,
      qualifiedPapers: 5,
    });

    const asUser = t.withIdentity({ subject: "clerk_prog9" });
    const result = await asUser.query(api.screening.queries.getScreeningProgress, { jobId });

    expect(result).not.toBeNull();
    expect(result!.percentComplete).toBe(100); // Terminal → always 100%
    expect(result!.status).toBe("completed");
  });
});

describe("getScreeningJob", () => {
  it("returns full job record for owner", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_job1", "job1@test.com");
    const jobId = await seedScreeningJob(t, user._id, {
      status: "processing",
      totalPapers: 5,
      processedPapers: 2,
    });

    const asUser = t.withIdentity({ subject: "clerk_job1" });
    const result = await asUser.query(api.screening.queries.getScreeningJob, { jobId });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("processing");
    expect(result!.totalPapers).toBe(5);
    expect(result!.processedPapers).toBe(2);
    expect(result!.questions).toHaveLength(1);
    expect(result!.userId).toBeDefined();
  });

  it("returns null for non-owner", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_job2", "job2@test.com");
    const user2 = await seedUser(t, "clerk_job3", "job3@test.com");
    const jobId = await seedScreeningJob(t, user1._id);

    const asUser2 = t.withIdentity({ subject: "clerk_job3" });
    const result = await asUser2.query(api.screening.queries.getScreeningJob, { jobId });
    expect(result).toBeNull();
  });
});

describe("listUserScreeningJobs", () => {
  it("returns empty array when no jobs exist for user", async () => {
    const t = convexTest(schema);
    await seedUser(t, "clerk_list1", "list1@test.com");
    const asUser = t.withIdentity({ subject: "clerk_list1" });

    const result = await asUser.query(api.screening.queries.listUserScreeningJobs, {});
    expect(result).toEqual([]);
  });

  it("returns jobs ordered by creation time descending (newest first)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_list2", "list2@test.com");

    // Create three jobs with different statuses
    const job1 = await seedScreeningJob(t, user._id, { status: "completed" });
    const job2 = await seedScreeningJob(t, user._id, { status: "processing" });
    const job3 = await seedScreeningJob(t, user._id, { status: "cancelled" });

    const asUser = t.withIdentity({ subject: "clerk_list2" });
    const result = await asUser.query(api.screening.queries.listUserScreeningJobs, {});

    expect(result).toHaveLength(3);
    // Newest first (desc order by _creationTime)
    expect(result[0]._id).toBe(job3);
    expect(result[1]._id).toBe(job2);
    expect(result[2]._id).toBe(job1);
  });

  it("respects limit parameter (default 20)", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_list3", "list3@test.com");

    // Create 3 jobs, request limit of 2
    await seedScreeningJob(t, user._id, { status: "completed" });
    await seedScreeningJob(t, user._id, { status: "processing" });
    await seedScreeningJob(t, user._id, { status: "cancelled" });

    const asUser = t.withIdentity({ subject: "clerk_list3" });
    const result = await asUser.query(api.screening.queries.listUserScreeningJobs, { limit: 2 });

    expect(result).toHaveLength(2);
  });

  it("returns only jobs belonging to authenticated user (user isolation)", async () => {
    const t = convexTest(schema);
    const user1 = await seedUser(t, "clerk_list4", "list4@test.com");
    const user2 = await seedUser(t, "clerk_list5", "list5@test.com");

    // User1 has 2 jobs, User2 has 1 job
    await seedScreeningJob(t, user1._id, { status: "completed" });
    await seedScreeningJob(t, user1._id, { status: "processing" });
    await seedScreeningJob(t, user2._id, { status: "cancelled" });

    const asUser1 = t.withIdentity({ subject: "clerk_list4" });
    const result1 = await asUser1.query(api.screening.queries.listUserScreeningJobs, {});
    expect(result1).toHaveLength(2);

    const asUser2 = t.withIdentity({ subject: "clerk_list5" });
    const result2 = await asUser2.query(api.screening.queries.listUserScreeningJobs, {});
    expect(result2).toHaveLength(1);
  });

  it("returns empty array for unauthenticated users", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_list6", "list6@test.com");
    await seedScreeningJob(t, user._id);

    // No identity
    const result = await t.query(api.screening.queries.listUserScreeningJobs, {});
    expect(result).toEqual([]);
  });
});
