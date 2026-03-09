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
      status: overrides.status ?? "processing",
      totalPapers: overrides.totalPapers ?? 10,
      processedPapers: overrides.processedPapers ?? 3,
      failedPapers: overrides.failedPapers ?? 1,
      qualifiedPapers: overrides.qualifiedPapers ?? 2,
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
      await ctx.db.delete(jobId);
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
    expect(result!.percentComplete).toBe(30); // 3/10 * 100 = 30
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

  it("percentComplete rounds correctly (e.g., 3/7 papers -> 43%)", async () => {
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
    expect(result!.percentComplete).toBe(43); // Math.round(3/7 * 100) = 43
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
    const job3 = await seedScreeningJob(t, user._id, { status: "pending" });

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
    await seedScreeningJob(t, user._id, { status: "pending" });

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
    await seedScreeningJob(t, user2._id, { status: "pending" });

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
