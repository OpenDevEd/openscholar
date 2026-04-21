/**
 * Plan-02 per-question decomposition — the pair of contracts the
 * workflow handler relies on once it fans out one step per (paper,
 * question):
 *
 *   - recordOneAnswer / recordOneAnswerFailure persist exactly one
 *     extractionResults row per question and bill at most once.
 *   - finalizePaper aggregates those rows through aggregatePaperStatus
 *     and flips the paper terminal when every question resolves.
 *
 * Tests here drive the mutations directly — the LLM step (extractOneQuestion)
 * has no deterministic harness, so its per-question idempotency is
 * covered by exercising recordOneAnswer twice (which the action calls)
 * and asserting on the same billing/aggregate invariants.
 */

import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import type { Id } from "../_generated/dataModel";
import { setupAggregates } from "./aggregates.test-support";
import { readAggregateCounters } from "./aggregates";

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
  creditsId: Id<"credits">;
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
    const creditsId = await ctx.db.insert("credits", {
      userId,
      freeBalance: 0,
      paidBalance: opts.startingCredits ?? 10_000,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      totalPapers: opts.paperCount,
      processedPapers: 0,
      failedPapers: 0,
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
    return { userId, jobId, paperIds, creditsId };
  });
}

async function readBalance(
  t: ReturnType<typeof convexTest>,
  creditsId: Id<"credits">,
): Promise<number> {
  const row = await t.run((ctx) => ctx.db.get("credits", creditsId));
  return row!.paidBalance;
}

describe("plan-02 per-question decomposition", () => {
  it("3 papers × 5 questions → 15 result rows, 15 debits, 3 paper-completes, 1 job-complete", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const questionKeys = ["q1", "q2", "q3", "q4", "q5"];
    const { jobId, paperIds, creditsId } = await seedJobWithPapersAndQuestions(
      t,
      { paperCount: 3, questionKeys, startingCredits: 1000 },
    );

    for (const paperId of paperIds) {
      for (const key of questionKeys) {
        await t.mutation(
          internal.extraction.mutations.results.recordOneAnswer,
          {
            paperId,
            questionKey: key,
            result: {
              answer: `ans-${key}`,
              confidence: 0.9,
              reasoning: "r",
              citations: [],
              citationStatus: "grounded" as const,
            },
            creditsUsed: 2,
          },
        );
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
    // All billed exactly once.
    expect(allResults.every((r) => r.billed === true)).toBe(true);
    expect(allResults.every((r) => r.status === "completed")).toBe(true);
    expect(allResults.every((r) => r.attemptCount === 1)).toBe(true);

    // 15 debits × 2 credits = 30 debited.
    expect(await readBalance(t, creditsId)).toBe(1000 - 30);

    // Each paper: completed + creditsUsed = 2 × 5 = 10.
    for (const paperId of paperIds) {
      const p = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
      expect(p?.status).toBe("completed");
      expect(p?.creditsUsed).toBe(10);
    }

    // Job transitioned to completed via maybeFinalizeJob.
    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.status).toBe("completed");
    expect(job?.processedPapers).toBe(3);
    expect(job?.failedPapers).toBe(0);
  });

  it("finalizePaper with mix of completed + hard-failed questions → completed with failedQuestions", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const questionKeys = ["q1", "q2", "q3"];
    const { jobId, paperIds, creditsId } = await seedJobWithPapersAndQuestions(
      t,
      { paperCount: 1, questionKeys, startingCredits: 100 },
    );
    const [paperId] = paperIds;

    // q1, q2 complete successfully.
    for (const key of ["q1", "q2"]) {
      await t.mutation(internal.extraction.mutations.results.recordOneAnswer, {
        paperId,
        questionKey: key,
        result: {
          answer: "A",
          confidence: 0.9,
          reasoning: "r",
          citations: [],
          citationStatus: "grounded" as const,
        },
        creditsUsed: 1,
      });
    }

    // q3 permanently fails (pdf_invalid is non-retryable).
    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswerFailure,
      {
        paperId,
        questionKey: "q3",
        error: {
          code: "pdf_invalid",
          message: "Corrupt PDF",
          retryable: false,
        },
      },
    );

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
    expect(job?.processedPapers).toBe(1);
    expect(job?.failedPapers).toBe(0);

    // Only the successful debits landed — 2 × 1 = 2.
    expect(await readBalance(t, creditsId)).toBe(100 - 2);
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
    await t.mutation(internal.extraction.mutations.results.recordOneAnswer, {
      paperId,
      questionKey: "q1",
      result: {
        answer: "A",
        confidence: 0.9,
        reasoning: "r",
        citations: [],
        citationStatus: "grounded" as const,
      },
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
    const { jobId, paperIds, creditsId } = await seedJobWithPapersAndQuestions(
      t,
      { paperCount: 1, questionKeys, startingCredits: 25 },
    );
    const [paperId] = paperIds;

    await Promise.all(
      questionKeys.map((questionKey) =>
        t.mutation(internal.extraction.mutations.results.recordOneAnswer, {
          paperId,
          questionKey,
          result: {
            answer: `A-${questionKey}`,
            confidence: 0.9,
            reasoning: "r",
            citations: [],
            citationStatus: "grounded" as const,
          },
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
    expect(job?.processedPapers).toBe(1);
    expect(job?.failedPapers).toBe(0);

    expect(await readBalance(t, creditsId)).toBe(25 - 6);
  });

  it("recordOneAnswer is idempotent under workpool retry — one debit, one aggregate row", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds, creditsId } = await seedJobWithPapersAndQuestions(
      t,
      { paperCount: 1, questionKeys: ["q1"], startingCredits: 100 },
    );
    const [paperId] = paperIds;

    const args = {
      paperId,
      questionKey: "q1",
      result: {
        answer: "A",
        confidence: 0.9,
        reasoning: "r",
        citations: [],
        citationStatus: "grounded" as const,
      },
      creditsUsed: 7,
    };

    // First call debits 7, billed=true.
    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswer,
      args,
    );
    expect(await readBalance(t, creditsId)).toBe(100 - 7);

    // Retry short-circuits on billed=true.
    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswer,
      args,
    );
    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswer,
      args,
    );
    expect(await readBalance(t, creditsId)).toBe(100 - 7);

    // Exactly one aggregate entry persisted (not three).
    const counters = await t.run((ctx) =>
      readAggregateCounters(ctx, jobId, "q1"),
    );
    expect(counters.totalPapers).toBe(1);
    expect(counters.groundedCount).toBe(1);
  });

  it("recordOneAnswer skips stale-epoch persists and billing", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds, creditsId } = await seedJobWithPapersAndQuestions(
      t,
      { paperCount: 1, questionKeys: ["q1"], startingCredits: 100 },
    );
    const [paperId] = paperIds;

    await t.run(async (ctx) => {
      await ctx.db.patch("extractionJobs", jobId, { runEpoch: 3 });
    });

    await t.mutation(internal.extraction.mutations.results.recordOneAnswer, {
      paperId,
      questionKey: "q1",
      result: {
        answer: "A",
        confidence: 0.9,
        reasoning: "r",
        citations: [],
        citationStatus: "grounded" as const,
      },
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
    expect(await readBalance(t, creditsId)).toBe(100);
  });

  it("retryable failure → subsequent success upgrades the same row without double-counting the aggregate", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedJobWithPapersAndQuestions(t, {
      paperCount: 1,
      questionKeys: ["q1"],
    });
    const [paperId] = paperIds;

    // First pass: terminal retry exhaust writes a failure row.
    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswerFailure,
      {
        paperId,
        questionKey: "q1",
        error: {
          code: "rate_limit",
          message: "429",
          retryable: true,
        },
      },
    );

    const afterFail = await t.run((ctx) =>
      readAggregateCounters(ctx, jobId, "q1"),
    );
    expect(afterFail.totalPapers).toBe(1);
    expect(afterFail.extractionErrorCount).toBe(1);
    expect(afterFail.groundedCount).toBe(0);

    // Second pass: user retry (plan 05) re-runs the action and this
    // time it succeeds — recordOneAnswer upgrades the same row.
    await t.mutation(internal.extraction.mutations.results.recordOneAnswer, {
      paperId,
      questionKey: "q1",
      result: {
        answer: "A",
        confidence: 0.9,
        reasoning: "r",
        citations: [],
        citationStatus: "grounded" as const,
      },
      creditsUsed: 1,
    });

    const afterSuccess = await t.run((ctx) =>
      readAggregateCounters(ctx, jobId, "q1"),
    );
    expect(afterSuccess.totalPapers).toBe(1);
    expect(afterSuccess.groundedCount).toBe(1);
    expect(afterSuccess.extractionErrorCount).toBe(0);

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
      await t.mutation(
        internal.extraction.mutations.results.recordOneAnswerFailure,
        {
          paperId,
          questionKey: key,
          error: {
            code: "pdf_invalid",
            message: "bad pdf",
            retryable: false,
          },
        },
      );
    }

    await t.mutation(internal.extraction.mutations.results.finalizePaper, {
      paperId,
    });

    const paper = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(paper?.status).toBe("failed");

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.status).toBe("failed");
    expect(job?.failedPapers).toBe(1);
    expect(job?.processedPapers).toBe(0);
  });
});
