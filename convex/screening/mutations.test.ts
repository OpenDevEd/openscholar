import { convexTest } from "convex-test";
import { describe, it, expect, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import schema from "../schema";
import {
  readScreeningProgressCounts,
  recordQualifiedResult,
  recordTerminalResult,
} from "./aggregates";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { setupScreeningWorkpool } from "./workpool.test-support";
import { createJob } from "./createJob.test-support";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { SCREENING_POOL_SIZE } from "../workpool";

import { encodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";

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
      libraryItemCount: 0,
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
  await t.run(async (ctx) => {
    await seedCreditsForTest(ctx, {
      userId,
      free: freeBalance,
      paid: paidBalance,
      now: Date.now(),
    });
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
      questions: [{ key: "q1", question: "Is this relevant?" }],
      resultCounts: "sharded",
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
    score: number;
    stars: number;
    answers: Record<string, boolean | null>;
    authors: string[];
    publicationYear: number;
    doi: string;
  }> = {},
) {
  return await t.run(async (ctx) => {
    const resultId = await ctx.db.insert("screeningResults", {
      jobId,
      openalexId: overrides.openalexId ?? `https://openalex.org/W${Date.now()}`,
      title: overrides.title ?? "Screening Result",
      status: overrides.status ?? "processing",
      ...(overrides.answers !== undefined ? { answers: overrides.answers } : {}),
      ...(overrides.score !== undefined ? { score: overrides.score } : {}),
      ...(overrides.stars !== undefined ? { stars: overrides.stars } : {}),
      ...(overrides.authors !== undefined ? { authors: overrides.authors } : {}),
      ...(overrides.publicationYear !== undefined
        ? { publicationYear: overrides.publicationYear }
        : {}),
      ...(overrides.doi !== undefined ? { doi: overrides.doi } : {}),
      ...(overrides.qualified !== undefined
        ? { qualified: overrides.qualified }
        : {}),
      createdAt: Date.now(),
    });
    return (await ctx.db.get("screeningResults", resultId))!;
  });
}

async function seedCollection(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const collectionId = await ctx.db.insert("collections", {
      userId,
      name: "Screening Target",
      itemCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return (await ctx.db.get("collections", collectionId))!;
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
      createJob(t, {
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
      createJob(asUser, {
        papers: [],
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      })
    ).rejects.toThrow("VALIDATION_ERROR");
  });

  it("rejects when papers exceed MAX_SCREENING_PAPERS_PER_JOB", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 1000, 0);
    const asUser = t.withIdentity({ subject: "clerk_test" });

    await expect(
      createJob(asUser, {
        papers: makePapers(MAX_SCREENING_PAPERS_PER_JOB + 1),
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
      createJob(asUser, {
        papers: makePapers(50),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      })
    ).rejects.toThrow("INSUFFICIENT_CREDITS");
  });

  it("succeeds when user has a completed job (not blocking)", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    await seedScreeningJob(t, user._id, "completed");
    const asUser = t.withIdentity({ subject: "clerk_test" });

    const result = await createJob(asUser, {
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

    const result = await createJob(asUser, {
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

    const result = await createJob(asUser, {
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

    const result = await createJob(asUser, {
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
    expect(job!.questions).toEqual(questions);
    expect(job!.scoringConfig).toEqual(scoringConfig);
    expect(job!.createdAt).toBeGreaterThan(0);
    expect(job!.updatedAt).toBeGreaterThan(0);
  });

  it("creates one processing screeningResults record per paper with work ids", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    const asUser = t.withIdentity({ subject: "clerk_test" });

    const papers = makePapers(5);
    const result = await createJob(asUser, {
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

    const result = await createJob(asUser, {
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

    const result = await createJob(asUser, {
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

    const result = await createJob(asUser, {
        papers: makePapers(50),
        questions: defaultQuestions,
        scoringConfig: defaultScoringConfig,
      }
    );
    expect(result.jobId).toBeDefined();
  });
});

describe("persistQualifiedScreeningResult", () => {
  it("is idempotent across retries and only creates one collection link", async () => {
    const t = convexTest(schema);
    const user = await seedUser(t, "clerk_persist");
    const collection = await seedCollection(t, user._id);
    const job = await seedScreeningJob(t, user._id, "processing");

    await t.run(async (ctx) => {
      await ctx.db.patch("screeningJobs", job._id, {
        targetCollectionId: collection._id,
      });
    });

    const result = await seedScreeningResult(t, job._id, {
      status: "completed",
      openalexId: "https://openalex.org/Wpersist",
      title: "Persisted Paper",
      score: 4,
      stars: 3,
      qualified: true,
    });

    await t.mutation(
      internal.screening.mutations.persistQualifiedScreeningResult,
      { resultId: result._id },
    );
    await t.mutation(
      internal.screening.mutations.persistQualifiedScreeningResult,
      { resultId: result._id },
    );

    await t.run(async (ctx) => {
      const updatedResult = await ctx.db.get("screeningResults", result._id);
      const libraryItems = await ctx.db
        .query("libraryItems")
        .withIndex("by_user_openalexId", (q) =>
          q.eq("userId", user._id).eq("openalexId", "https://openalex.org/Wpersist"),
        )
        .collect();
      const links = await ctx.db
        .query("libraryItemCollections")
        .withIndex("by_collection_item", (q) =>
          q
            .eq("collectionId", collection._id)
            .eq("libraryItemId", libraryItems[0]!._id),
        )
        .collect();

      expect(updatedResult?.savedToLibrary).toBe(true);
      expect(updatedResult?.libraryItemId).toBeDefined();
      expect(libraryItems).toHaveLength(1);
      expect(links).toHaveLength(1);
    });
  });
});

describe("Screen all on a saved search", () => {
  it("answers into the search's screening, so its page shows them next to its own answers (#334)", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    const asUser = t.withIdentity({ subject: "clerk_test" });
    const search = {
      id: "local-search", query: "tutoring", field: "title" as const, count: 2, queryHistoryCount: 1, questionCount: 0, questionText: "",
      screeningQuestions: [{ question: "Is this relevant?" }], screeningResponses: [{ paperId: "https://openalex.org/W2", responses: [{ question: "Is this relevant?", response: false }] }],
      createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    };
    await asUser.mutation(api.research.records.importBatch, { accountId: "clerk_test", searches: [{ search, history: { queryHistory: [], questionHistory: [] } }], shortcuts: [], ratings: [] });

    const { jobId } = await createJob(asUser, {
      papers: makePapers(1), questions: [...defaultQuestions, { key: "q2", question: "Adults?" }], scoringConfig: defaultScoringConfig, searchId: search.id,
    });
    const result = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).unique());
    vi.useFakeTimers();
    await t.mutation(internal.screening.mutations.handleScreeningComplete, {
      workId: "work_search",
      context: { jobId, resultId: result!._id },
      result: { kind: "success", returnValue: { responses: encodeQuestionResponseMap({ "Is this relevant?": true }), confidences: encodeQuestionResponseMap({ "Is this relevant?": 0.8 }), confidence: 0.8 } },
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();
    const shown = await asUser.query(api.research.records.getSearch, { accountId: "clerk_test", id: search.id });
    expect(shown?.screeningResponses).toEqual([
      { paperId: "https://openalex.org/W1", responses: [{ question: "Is this relevant?", response: true }, { question: "Adults?", response: null }] },
      { paperId: "https://openalex.org/W2", responses: [{ question: "Is this relevant?", response: false }] },
    ]);
    // The search took on the job's question it didn't have, so its page shows that answer too.
    expect(shown?.screeningQuestions).toEqual([{ question: "Is this relevant?" }, { question: "Adults?" }]);
    const screenings = await t.run((ctx) => ctx.db.query("screenings").collect());
    expect(screenings).toHaveLength(1);
  });

  it("refuses a search that isn't the person's", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_test");
    await seedCredits(t, user._id, 100, 0);
    const asUser = t.withIdentity({ subject: "clerk_test" });
    await expect(createJob(asUser, {
      papers: makePapers(1), questions: defaultQuestions, scoringConfig: defaultScoringConfig, searchId: "someone-elses",
    })).rejects.toThrow("Search not found");
  });
});

describe("creating a large Screen all job", () => {
  it(`creates every result of a ${MAX_SCREENING_PAPERS_PER_JOB}-paper job within Convex's limits, a batch at a time`, async () => {
    const t = convexTest({ schema, transactionLimits: true });
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_big");
    await seedCredits(t, user._id, 100_000, 0);
    const { jobId } = await createJob(t.withIdentity({ subject: "clerk_big" }), {
      papers: makePapers(MAX_SCREENING_PAPERS_PER_JOB), questions: defaultQuestions, scoringConfig: defaultScoringConfig,
    });
    // Each later batch is its own scheduled transaction, run here without the papers' screening.
    for (let batch = 1; batch < MAX_SCREENING_PAPERS_PER_JOB / 250; batch++) {
      const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      const next = scheduled.filter((fn) => fn.name === "screening/mutations:createScreeningResults").at(-1);
      await t.mutation(internal.screening.mutations.createScreeningResults, next!.args[0] as never);
    }
    const results = await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
    expect(results).toHaveLength(MAX_SCREENING_PAPERS_PER_JOB);
    expect(new Set(results.map((r) => r.openalexId)).size).toBe(MAX_SCREENING_PAPERS_PER_JOB);
    // The person's slots' worth start; the rest wait their turn (./slots.ts).
    expect(results.filter((r) => r.workId)).toHaveLength(SCREENING_POOL_SIZE);
    expect(results.filter((r) => r.waitingSince !== undefined)).toHaveLength(MAX_SCREENING_PAPERS_PER_JOB - SCREENING_POOL_SIZE);
  }, 300_000);

  it("creates no more results once the job is cancelled", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const user = await seedUser(t, "clerk_cancel_early");
    await seedCredits(t, user._id, 100_000, 0);
    const asUser = t.withIdentity({ subject: "clerk_cancel_early" });
    const { jobId } = await createJob(asUser, { papers: makePapers(600), questions: defaultQuestions, scoringConfig: defaultScoringConfig });
    await asUser.mutation(api.screening.mutations.cancelScreeningJob, { jobId });
    const pending = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const next = pending.find((fn) => fn.name === "screening/mutations:createScreeningResults");
    await t.mutation(internal.screening.mutations.createScreeningResults, next!.args[0] as never);
    expect(await t.run((ctx) => ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect())).toHaveLength(250);
  });
});

describe("handleScreeningComplete", () => {
  it("keeps qualified completion row-local until scheduled follow-ups run", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      setupScreeningWorkpool(t);
      const user = await seedUser(t, "clerk_complete_success");
      const collection = await seedCollection(t, user._id);
      const job = await seedScreeningJob(t, user._id, "processing");

      await t.run(async (ctx) => {
        await ctx.db.patch("screeningJobs", job._id, {
          totalPapers: 1,
          targetCollectionId: collection._id,
        });
      });

      const result = await seedScreeningResult(t, job._id, {
        status: "processing",
        openalexId: "https://openalex.org/Wsuccess",
        title: "Qualified Paper",
      });

      await t.mutation(internal.screening.mutations.handleScreeningComplete, {
        workId: "work_success",
        context: { jobId: job._id, resultId: result._id },
        result: {
          kind: "success",
          returnValue: {
            responses: encodeQuestionResponseMap({
              "Is this relevant?": true,
            }),
            confidences: encodeQuestionResponseMap({ "Is this relevant?": 0.91 }),
            confidence: 0.91,
          },
        },
      });

      await t.run(async (ctx) => {
        const updatedResult = await ctx.db.get("screeningResults", result._id);
        const updatedJob = await ctx.db.get("screeningJobs", job._id);
        const libraryItems = await ctx.db
          .query("libraryItems")
          .withIndex("by_user_openalexId", (q) =>
            q.eq("userId", user._id).eq("openalexId", "https://openalex.org/Wsuccess"),
          )
          .collect();
        const scheduledFunctions = await ctx.db.system
          .query("_scheduled_functions")
          .collect();

        expect(updatedResult?.status).toBe("completed");
        // The answer waits on the row, with the model's confidence in it, for the job's writer.
        expect(updatedResult).toMatchObject({ answers: { q1: true }, confidences: { q1: 0.91 }, pendingAnswers: true });
        expect(updatedResult?.savedToLibrary).toBeUndefined();
        expect(updatedJob?.status).toBe("processing");
        expect(libraryItems).toHaveLength(0);
        // The paper wrote only its row and joined the bookkeeping queue.
        expect(updatedResult?.doneAt).toBeDefined();
        expect(scheduledFunctions.map((fn) => fn.name).filter((name) => name.startsWith("screening/"))).toEqual([]);
      });

      await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));

      await t.run(async (ctx) => {
        const updatedResult = await ctx.db.get("screeningResults", result._id);
        const updatedJob = await ctx.db.get("screeningJobs", job._id);
        const libraryItems = await ctx.db
          .query("libraryItems")
          .withIndex("by_user_openalexId", (q) =>
            q.eq("userId", user._id).eq("openalexId", "https://openalex.org/Wsuccess"),
          )
          .collect();
        const links = await ctx.db
          .query("libraryItemCollections")
          .withIndex("by_collection_item", (q) =>
            q
              .eq("collectionId", collection._id)
              .eq("libraryItemId", updatedResult!.libraryItemId!),
          )
          .collect();
        const counts = await readScreeningProgressCounts(ctx, job);
        // Then the answer is in the job's screening, with the model's confidence, and not on the row.
        const answerRows = await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", updatedJob!.screeningId!)).collect();
        expect(answerRows.map((row) => ({ paperId: row.paperId, answers: row.answers.map(({ question, answer, setBy, model }) => ({ question, answer, setBy, confidence: model?.confidence })) }))).toEqual([
          { paperId: "https://openalex.org/Wsuccess", answers: [{ question: "Is this relevant?", answer: true, setBy: "model", confidence: 0.91 }] },
        ]);
        expect([updatedResult?.answers, updatedResult?.confidences, updatedResult?.pendingAnswers]).toEqual([undefined, undefined, undefined]);

        expect(updatedResult?.savedToLibrary).toBe(true);
        expect(updatedResult?.libraryItemId).toBeDefined();
        expect(updatedJob?.status).toBe("completed");
        expect(libraryItems).toHaveLength(1);
        expect(links).toHaveLength(1);
        expect(counts).toEqual({
          completedCount: 1,
          skippedCount: 0,
          failedCount: 0,
          qualifiedCount: 1,
        });
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks failed work rows terminal and defers job completion to the finalizer", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const user = await seedUser(t, "clerk_complete_failed");
      const job = await seedScreeningJob(t, user._id, "processing");

      await t.run(async (ctx) => {
        await ctx.db.patch("screeningJobs", job._id, { totalPapers: 1 });
      });

      const result = await seedScreeningResult(t, job._id, {
        status: "processing",
        openalexId: "https://openalex.org/Wfailed",
      });

      await t.mutation(internal.screening.mutations.handleScreeningComplete, {
        workId: "work_failed",
        context: { jobId: job._id, resultId: result._id },
        result: {
          kind: "failed",
          error: "screening exploded",
        },
      });

      await t.run(async (ctx) => {
        const updatedResult = await ctx.db.get("screeningResults", result._id);
        const updatedJob = await ctx.db.get("screeningJobs", job._id);

        expect(updatedResult?.status).toBe("failed");
        expect(updatedResult?.errorMessage).toBe("screening exploded");
        expect(updatedJob?.status).toBe("processing");
      });

      await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));

      await t.run(async (ctx) => {
        const updatedJob = await ctx.db.get("screeningJobs", job._id);
        const counts = await readScreeningProgressCounts(ctx, job);

        expect(updatedJob?.status).toBe("completed");
        expect(counts).toEqual({
          completedCount: 0,
          skippedCount: 0,
          failedCount: 1,
          qualifiedCount: 0,
        });
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["cancelled", "creditsExhausted"] as const)(
    "marks rows skipped with no side effects when the job is %s",
    async (status) => {
      vi.useFakeTimers();
      try {
        const t = convexTest(schema);
        const user = await seedUser(t, `clerk_${status}`);
        const job = await seedScreeningJob(t, user._id, status);
        const result = await seedScreeningResult(t, job._id, {
          status: "processing",
          openalexId: `https://openalex.org/W${status}`,
        });

        await t.mutation(internal.screening.mutations.handleScreeningComplete, {
          workId: `work_${status}`,
          context: { jobId: job._id, resultId: result._id },
          result: {
            kind: "success",
            returnValue: {
              responses: encodeQuestionResponseMap({
                "Is this relevant?": true,
              }),
              confidence: 0.5,
            },
          },
        });

        await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));

        await t.run(async (ctx) => {
          const updatedResult = await ctx.db.get("screeningResults", result._id);
          const updatedJob = await ctx.db.get("screeningJobs", job._id);
          const libraryItems = await ctx.db
            .query("libraryItems")
            .withIndex("by_user_openalexId", (q) =>
              q.eq("userId", user._id).eq("openalexId", `https://openalex.org/W${status}`),
            )
            .collect();
          const counts = await readScreeningProgressCounts(ctx, job);

          expect(updatedResult?.status).toBe("skipped");
          expect(updatedResult?.savedToLibrary).toBeUndefined();
          expect(updatedResult?.libraryItemId).toBeUndefined();
          expect(updatedJob?.status).toBe(status);
          expect(libraryItems).toHaveLength(0);
          expect(counts).toEqual({
            completedCount: 0,
            skippedCount: 1,
            failedCount: 0,
            qualifiedCount: 0,
          });
        });
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
