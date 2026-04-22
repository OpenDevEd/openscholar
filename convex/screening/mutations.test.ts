import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import {
  recordQualifiedResult,
  recordTerminalResult,
} from "./aggregates";
import { setupScreeningAggregates } from "./aggregates.test-support";
import { setupScreeningWorkpool } from "./workpool.test-support";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedUser(
  t: ReturnType<typeof convexTest>,
  clerkId: string,
  email = "test@example.com"
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

async function seedCredits(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  freeBalance: number,
  paidBalance: number
) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("credits", {
      userId,
      freeBalance,
      paidBalance,
      lifetimeUsed: 0,
      lastUpdatedAt: Date.now(),
    });
    return (await ctx.db.get("credits", id))!;
  });
}

async function seedScreeningJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  status: "processing" | "completed" | "cancelled" | "failed" | "creditsExhausted"
) {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("screeningJobs", {
      userId,
      status,
      totalPapers: 10,
      processedPapers: 0,
      failedPapers: 0,
      qualifiedPapers: 0,
      questions: [{ key: "q1", question: "Is this relevant?" }],
      scoringConfig: {
        rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }],
        starThresholds: [{ minScore: 0, stars: 1 }],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return (await ctx.db.get("screeningJobs", id))!;
  });
}

async function seedScreeningResult(
  t: ReturnType<typeof convexTest>,
  jobId: Id<"screeningJobs">,
  overrides: Partial<{
    status: "processing" | "completed" | "failed" | "skipped";
    qualified: boolean;
    openalexId: string;
    title: string;
  }> = {},
) {
  return await t.run(async (ctx) => {
    const resultId = await ctx.db.insert("screeningResults", {
      jobId,
      openalexId: overrides.openalexId ?? `https://openalex.org/W${Date.now()}`,
      title: overrides.title ?? "Screening Result",
      status: overrides.status ?? "processing",
      ...(overrides.qualified !== undefined
        ? { qualified: overrides.qualified }
        : {}),
      createdAt: Date.now(),
    });
    return (await ctx.db.get("screeningResults", resultId))!;
  });
}

function makePaper(index: number) {
  return {
    openalexId: `https://openalex.org/W${index}`,
    title: `Paper ${index}`,
    abstract: `Abstract for paper ${index}`,
    authors: [`Author ${index}`],
    publicationYear: 2024,
    doi: `10.1234/${index}`,
  };
}

function makePapers(count: number) {
  return Array.from({ length: count }, (_, i) => makePaper(i + 1));
}

const defaultQuestions = [{ key: "q1", question: "Is this relevant?" }];
const defaultScoringConfig = {
  rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }],
  starThresholds: [{ minScore: 0, stars: 1 }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createScreeningJob", () => {
  it("rejects unauthenticated calls", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    await expect(
      t.mutation(api.screening.mutations.createScreeningJob, {
        papers: makePapers(5),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      })
    ).rejects.toThrow();
  });

  it("rejects when papers array is empty", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    const asUser = t.withIdentity({ subject: "clerk_test" });

    await expect(
      asUser.mutation(api.screening.mutations.createScreeningJob, {
        papers: [],
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      })
    ).rejects.toThrow("VALIDATION_ERROR");
  });

  it("rejects when papers exceed MAX_SCREENING_PAPERS_PER_JOB (201 papers)", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 1000, 0);
    const asUser = t.withIdentity({ subject: "clerk_test" });

    await expect(
      asUser.mutation(api.screening.mutations.createScreeningJob, {
        papers: makePapers(201),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      })
    ).rejects.toThrow("VALIDATION_ERROR");
  });

  it("rejects when user has insufficient credits", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 5, 5); // 10 total, but wants 50 papers
    const asUser = t.withIdentity({ subject: "clerk_test" });

    await expect(
      asUser.mutation(api.screening.mutations.createScreeningJob, {
        papers: makePapers(50),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      })
    ).rejects.toThrow("INSUFFICIENT_CREDITS");
  });

  it("rejects when user has a processing screening job", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    await seedScreeningJob(t, user._id, "processing");
    const asUser = t.withIdentity({ subject: "clerk_test" });

    await expect(
      asUser.mutation(api.screening.mutations.createScreeningJob, {
        papers: makePapers(5),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      })
    ).rejects.toThrow("SCREENING_JOB_ALREADY_ACTIVE");
  });

  it("succeeds when user has a completed job (not blocking)", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    await seedScreeningJob(t, user._id, "completed");
    const asUser = t.withIdentity({ subject: "clerk_test" });

    const result = await asUser.mutation(
      api.screening.mutations.createScreeningJob,
      {
        papers: makePapers(5),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      }
    );
    expect(result.jobId).toBeDefined();
  });

  it("succeeds when user has a cancelled job (not blocking)", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    await seedScreeningJob(t, user._id, "cancelled");
    const asUser = t.withIdentity({ subject: "clerk_test" });

    const result = await asUser.mutation(
      api.screening.mutations.createScreeningJob,
      {
        papers: makePapers(5),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      }
    );
    expect(result.jobId).toBeDefined();
  });

  it("succeeds when user has a failed job (not blocking)", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    await seedScreeningJob(t, user._id, "failed");
    const asUser = t.withIdentity({ subject: "clerk_test" });

    const result = await asUser.mutation(
      api.screening.mutations.createScreeningJob,
      {
        papers: makePapers(5),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      }
    );
    expect(result.jobId).toBeDefined();
  });

  it("creates a processing screening job record with correct fields", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    const asUser = t.withIdentity({ subject: "clerk_test" });

    const questions = [
      { key: "q1", question: "Is this relevant?" },
      { key: "q2", question: "Is this high quality?" },
    ];
    const scoringConfig = {
      rules: [
        { questionKey: "q1", yesPoints: 2, noPoints: -1, nullPoints: 0 },
        { questionKey: "q2", yesPoints: 1, noPoints: 0, nullPoints: 0 },
      ],
      starThresholds: [
        { minScore: 0, stars: 1 },
        { minScore: 2, stars: 2 },
      ],
      minimumScore: 1,
    };

    const result = await asUser.mutation(
      api.screening.mutations.createScreeningJob,
      {
        papers: makePapers(10),
        questions,
        scoringConfig,
      }
    );

    // Verify job record
    const job = await t.run(async (ctx) => {
      return await ctx.db.get("screeningJobs", result.jobId);
    });

    expect(job).not.toBeNull();
    expect(job!.userId).toBe(user._id);
    expect(job!.status).toBe("processing");
    expect(job!.totalPapers).toBe(10);
    expect(job!.processedPapers).toBe(0);
    expect(job!.failedPapers).toBe(0);
    expect(job!.qualifiedPapers).toBe(0);
    expect(job!.questions).toEqual(questions);
    expect(job!.scoringConfig).toEqual(scoringConfig);
    expect(job!.createdAt).toBeGreaterThan(0);
    expect(job!.updatedAt).toBeGreaterThan(0);
    expect("workflowId" in job!).toBe(false);
  });

  it("creates one processing screeningResults record per paper with work ids", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    const asUser = t.withIdentity({ subject: "clerk_test" });

    const papers = makePapers(5);
    const result = await asUser.mutation(
      api.screening.mutations.createScreeningJob,
      {
        papers,
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      }
    );

    // Verify result records
    const results = await t.run(async (ctx) => {
      return await ctx.db
        .query("screeningResults")
        .withIndex("by_job", (q) => q.eq("jobId", result.jobId))
        .collect();
    });

    expect(results).toHaveLength(5);
    for (const r of results) {
      expect(r.status).toBe("processing");
      expect(r.jobId).toBe(result.jobId);
      expect(typeof r.workId).toBe("string");
      expect(r.createdAt).toBeGreaterThan(0);
    }

    // Verify each paper is represented
    const openalexIds = results.map((r) => r.openalexId).sort();
    const expectedIds = papers.map((p) => p.openalexId).sort();
    expect(openalexIds).toEqual(expectedIds);
  });

  it("returns { jobId } pointing to created job", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    const asUser = t.withIdentity({ subject: "clerk_test" });

    const result = await asUser.mutation(
      api.screening.mutations.createScreeningJob,
      {
        papers: makePapers(3),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      }
    );

    expect(result).toHaveProperty("jobId");
    const job = await t.run(async (ctx) => ctx.db.get("screeningJobs", result.jobId));
    expect(job).not.toBeNull();
  });

  it("accepts exactly 200 papers (boundary test)", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    // 200 papers * ESTIMATED_CREDITS_PER_PAPER (4.5) = 900 credits needed
    await seedCredits(t, user._id, 900, 0);
    const asUser = t.withIdentity({ subject: "clerk_test" });

    const result = await asUser.mutation(
      api.screening.mutations.createScreeningJob,
      {
        papers: makePapers(200),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      }
    );
    expect(result.jobId).toBeDefined();
  });

  it("credit check uses freeBalance + paidBalance (125 free + 100 paid = 225 total)", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    // 50 papers * ESTIMATED_CREDITS_PER_PAPER (4.5) = 225 credits needed
    await seedCredits(t, user._id, 125, 100); // 225 total
    const asUser = t.withIdentity({ subject: "clerk_test" });

    const result = await asUser.mutation(
      api.screening.mutations.createScreeningJob,
      {
        papers: makePapers(50),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      }
    );
    expect(result.jobId).toBeDefined();
  });
});

describe("finalizeScreeningJobIfDone", () => {
  it("finalizes from aggregate counts even when legacy counters are stale", async () => {
    const t = convexTest(schema);
    setupScreeningAggregates(t);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_finalize");
    const job = await seedScreeningJob(t, user._id, "processing");

    const completedQualified = await seedScreeningResult(t, job._id, {
      status: "completed",
      qualified: true,
      openalexId: "https://openalex.org/W1",
    });
    const completed = await seedScreeningResult(t, job._id, {
      status: "completed",
      qualified: false,
      openalexId: "https://openalex.org/W2",
    });
    const failed = await seedScreeningResult(t, job._id, {
      status: "failed",
      openalexId: "https://openalex.org/W3",
    });

    await t.run(async (ctx) => {
      await ctx.db.patch("screeningJobs", job._id, {
        totalPapers: 3,
        processedPapers: 0,
        failedPapers: 0,
        qualifiedPapers: 0,
      });
      await recordTerminalResult(ctx, completedQualified);
      await recordQualifiedResult(ctx, completedQualified);
      await recordTerminalResult(ctx, completed);
      await recordTerminalResult(ctx, failed);
    });

    await t.mutation(
      internal.screening.mutations.finalizeScreeningJobIfDone,
      { jobId: job._id },
    );

    const finalized = await t.run(async (ctx) =>
      ctx.db.get("screeningJobs", job._id),
    );
    expect(finalized).not.toBeNull();
    expect(finalized!.status).toBe("completed");
    expect(finalized!.completedAt).toBeGreaterThan(0);
    expect(finalized!.processedPapers).toBe(0);
    expect(finalized!.failedPapers).toBe(0);
    expect(finalized!.qualifiedPapers).toBe(0);
  });
});
