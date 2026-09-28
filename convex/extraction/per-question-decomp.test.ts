/**
 * Paper-level question-result decomposition — the pair of contracts the
 * paper worker relies on once it processes one paper at a time:
 *
 *   - recordQuestionBatch persists exactly one extractionResults row per
 *     question and bills at most once.
 *   - finalizePaper aggregates those rows through aggregatePaperStatus
 *     and flips the paper terminal when every question resolves.
 *
 * Tests here drive the mutations directly; the mocked full-flow test
 * covers the LLM-facing worker path.
 */

import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { setupAggregates } from "./aggregates.test-support";
import {
  seedCreditsForTest,
} from "../billing/billing.test-support";
import { readJobCounters } from "./jobCounters";

async function seedJobWithPapersAndQuestions(
  t: ReturnType<typeof convexTest>,
  opts: {
    paperCount: number;
    questionKeys: string[];
    startingCredits?: number;
  },
): Promise<{
  userId: Id<"users">;
  jobId: Id<"extractionJobs">;
  paperIds: Id<"extractionPapers">[];
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: `clerk_decomp_${now}`,
      email: "decomp@test.com",
      firstName: "T",
      lastName: "U",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    await seedCreditsForTest(ctx, {
      userId,
      free: 0,
      paid: opts.startingCredits ?? 10_000,
      now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      totalPapers: opts.paperCount,
      name: "Decomp Test",
      createdAt: now,
      updatedAt: now,
    });
    for (let i = 0; i < opts.questionKeys.length; i++) {
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: opts.questionKeys[i],
        question: `Q ${opts.questionKeys[i]}?`,
        type: "string" as const,
        order: i,
        createdAt: now,
      });
    }
    const paperIds: Id<"extractionPapers">[] = [];
    for (let i = 0; i < opts.paperCount; i++) {
      paperIds.push(
        await ctx.db.insert("extractionPapers", {
          jobId,
          openalexId: `oa:decomp${i}`,
          title: `Paper ${i}`,
          status: "extracting" as const,
        }),
      );
    }
    return { userId, jobId, paperIds };
  });
}


async function recordCompletedQuestion(
  t: ReturnType<typeof convexTest>,
  args: {
    paperId: Id<"extractionPapers">;
    questionKey: string;
    creditsUsed: number;
    answer?: string;
    expectedEpoch?: number;
  },
) {
  await t.mutation(internal.extraction.mutations.results.recordQuestionBatch, {
    paperId: args.paperId,
    expectedEpoch: args.expectedEpoch,
    completed: [
      {
        questionKey: args.questionKey,
        result: {
          answer: args.answer ?? "A",
          confidence: 0.9,
          reasoning: "r",
          citations: [],
          citationStatus: "grounded" as const,
        },
        creditsUsed: args.creditsUsed,
      },
    ],
    failed: [],
  });
}

async function recordFailedQuestion(
  t: ReturnType<typeof convexTest>,
  args: {
    paperId: Id<"extractionPapers">;
    questionKey: string;
    code: "pdf_invalid" | "rate_limit";
    message: string;
    retryable: boolean;
  },
) {
  await t.mutation(internal.extraction.mutations.results.recordQuestionBatch, {
    paperId: args.paperId,
    completed: [],
    failed: [
      {
        questionKey: args.questionKey,
        error: {
          code: args.code,
          message: args.message,
          retryable: args.retryable,
        },
      },
    ],
  });
}

describe("plan-02 per-question decomposition", () => {
  it("3 papers × 5 questions → 15 result rows, 3 paper-completes, 1 job-complete", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const questionKeys = ["q1", "q2", "q3", "q4", "q5"];
    const { jobId, paperIds } = await seedJobWithPapersAndQuestions(
      t,
      { paperCount: 3, questionKeys, startingCredits: 1000 },
    );

    for (const paperId of paperIds) {
      for (const key of questionKeys) {
        await recordCompletedQuestion(t, {
          paperId,
          questionKey: key,
          answer: `ans-${key}`,
          creditsUsed: 2,
        });
      }
      await t.mutation(internal.extraction.mutations.results.finalizePaper, {
        paperId,
      });
    }

    // 15 extractionResults rows — one per (paper, question).
    const allResults = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(allResults).toHaveLength(15);
    // Each answer counted exactly once.
    expect(allResults.every((r) => r.billed === true)).toBe(true);
    expect(allResults.every((r) => r.status === "completed")).toBe(true);
    expect(allResults.every((r) => r.attemptCount === 1)).toBe(true);

    // Each paper: completed + creditsUsed = 2 × 5 = 10.
    for (const paperId of paperIds) {
      const p = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
      expect(p?.status).toBe("completed");
      expect(p?.creditsUsed).toBe(10);
    }

    // Job transitioned to completed via maybeFinalizeJob.
    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.status).toBe("completed");
    const counters = await t.run((ctx) => readJobCounters(ctx, jobId));
    expect(counters.processed).toBe(3);
    expect(counters.failed).toBe(0);
  });

  it("finalizePaper with mix of completed + hard-failed questions → completed with failedQuestions", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const questionKeys = ["q1", "q2", "q3"];
    const { jobId, paperIds } = await seedJobWithPapersAndQuestions(
      t,
      { paperCount: 1, questionKeys, startingCredits: 100 },
    );
    const [paperId] = paperIds;

    // q1, q2 complete successfully.
    for (const key of ["q1", "q2"]) {
      await recordCompletedQuestion(t, {
        paperId,
        questionKey: key,
        creditsUsed: 1,
      });
    }

    // q3 permanently fails (pdf_invalid is non-retryable).
    await recordFailedQuestion(t, {
      paperId,
      questionKey: "q3",
      code: "pdf_invalid",
      message: "Corrupt PDF",
      retryable: false,
    });

    await t.mutation(internal.extraction.mutations.results.finalizePaper, {
      paperId,
    });

    // Paper finalizes as completed with one failed question.
    const paper = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(paper?.status).toBe("completed");

    // Job finalizes as completed (the only paper succeeded modulo one
    // hard-failed question; failedPapers counts paper-level outcomes,
    // not question-level).
    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.status).toBe("completed");
    const jobCounters = await t.run((ctx) => readJobCounters(ctx, jobId));
    expect(jobCounters.processed).toBe(1);
    expect(jobCounters.failed).toBe(0);
  });

  it("finalizePaper is a no-op while a question is still pending", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const questionKeys = ["q1", "q2"];
    const { paperIds } = await seedJobWithPapersAndQuestions(t, {
      paperCount: 1,
      questionKeys,
    });
    const [paperId] = paperIds;

    // Only q1 resolves; q2 has no row yet.
    await recordCompletedQuestion(t, {
      paperId,
      questionKey: "q1",
      creditsUsed: 1,
    });

    await t.mutation(internal.extraction.mutations.results.finalizePaper, {
      paperId,
    });

    // Paper still extracting — rollup saw a pending question.
    const paper = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(paper?.status).toBe("extracting");
  });

  it("finalizePaper completes after concurrent question completions land", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const questionKeys = ["q1", "q2"];
    const { jobId, paperIds } = await seedJobWithPapersAndQuestions(
      t,
      { paperCount: 1, questionKeys, startingCredits: 25 },
    );
    const [paperId] = paperIds;

    await Promise.all(
      questionKeys.map((questionKey) =>
        recordCompletedQuestion(t, {
          paperId,
          questionKey,
          answer: `A-${questionKey}`,
          creditsUsed: 3,
        }),
      ),
    );

    await t.mutation(internal.extraction.mutations.results.finalizePaper, {
      paperId,
    });

    const paper = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(paper?.status).toBe("completed");
    expect(paper?.creditsUsed).toBe(6);

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.status).toBe("completed");
    const jobCounters = await t.run((ctx) => readJobCounters(ctx, jobId));
    expect(jobCounters.processed).toBe(1);
    expect(jobCounters.failed).toBe(0);
  });

  it("recordQuestionBatch is idempotent under worker retry — one result row, credits counted once", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperIds } = await seedJobWithPapersAndQuestions(
      t,
      { paperCount: 1, questionKeys: ["q1"], startingCredits: 100 },
    );
    const [paperId] = paperIds;

    const args = {
      paperId,
      questionKey: "q1",
      creditsUsed: 7,
    };

    // Retries 2 and 3 short-circuit on result.billed=true so
    // creditsUsed stays at 7.
    await recordCompletedQuestion(t, args);
    await recordCompletedQuestion(t, args);
    await recordCompletedQuestion(t, args);

    await t.mutation(internal.extraction.mutations.results.finalizePaper, {
      paperId,
    });

    const paper = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(paper?.creditsUsed).toBe(7);

    const rows = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper_question", (q) =>
          q.eq("paperId", paperId).eq("questionKey", "q1"),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("completed");
    expect(rows[0]?.citationStatus).toBe("grounded");
  });

  it("recordQuestionBatch skips stale-epoch persists", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedJobWithPapersAndQuestions(
      t,
      { paperCount: 1, questionKeys: ["q1"], startingCredits: 100 },
    );
    const [paperId] = paperIds;

    await t.run(async (ctx) => {
      await ctx.db.patch("extractionJobs", jobId, { runEpoch: 3 });
    });

    await recordCompletedQuestion(t, {
      paperId,
      questionKey: "q1",
      creditsUsed: 7,
      expectedEpoch: 2,
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper_question", (q) =>
          q.eq("paperId", paperId).eq("questionKey", "q1"),
        )
        .collect(),
    );
    expect(rows).toEqual([]);
  });

  it("retryable failure → subsequent success upgrades the same row", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperIds } = await seedJobWithPapersAndQuestions(t, {
      paperCount: 1,
      questionKeys: ["q1"],
    });
    const [paperId] = paperIds;

    // First pass: terminal retry exhaust writes a failure row.
    await recordFailedQuestion(t, {
      paperId,
      questionKey: "q1",
      code: "rate_limit",
      message: "429",
      retryable: true,
    });

    const afterFail = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper_question", (q) =>
          q.eq("paperId", paperId).eq("questionKey", "q1"),
        )
        .unique(),
    );
    expect(afterFail?.status).toBe("failed");
    expect(afterFail?.citationStatus).toBe("extraction_error");

    // Second pass: user retry re-runs the paper worker and this time it
    // succeeds — recordQuestionBatch upgrades the same row.
    await recordCompletedQuestion(t, {
      paperId,
      questionKey: "q1",
      creditsUsed: 1,
    });

    const afterSuccess = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper_question", (q) =>
          q.eq("paperId", paperId).eq("questionKey", "q1"),
        )
        .unique(),
    );
    expect(afterSuccess?.status).toBe("completed");
    expect(afterSuccess?.citationStatus).toBe("grounded");

    // Only one result row ever exists for (paper, question).
    const rows = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper_question", (q) =>
          q.eq("paperId", paperId).eq("questionKey", "q1"),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].billed).toBe(true);
    expect(rows[0].status).toBe("completed");
    expect(rows[0].attemptCount).toBe(2);
  });

  it("all hard-failed questions → paper fails, failedPapers++", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const questionKeys = ["q1", "q2"];
    const { jobId, paperIds } = await seedJobWithPapersAndQuestions(t, {
      paperCount: 1,
      questionKeys,
    });
    const [paperId] = paperIds;

    for (const key of questionKeys) {
      await recordFailedQuestion(t, {
        paperId,
        questionKey: key,
        code: "pdf_invalid",
        message: "bad pdf",
        retryable: false,
      });
    }

    await t.mutation(internal.extraction.mutations.results.finalizePaper, {
      paperId,
    });

    const paper = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(paper?.status).toBe("failed");

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.status).toBe("failed");
    const jobCounters = await t.run((ctx) => readJobCounters(ctx, jobId));
    expect(jobCounters.failed).toBe(1);
    expect(jobCounters.processed).toBe(0);
  });
});
