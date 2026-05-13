/**
 * finalizePaper edge-case suite.
 *
 * Background — the stuck-at-99% bug:
 * runPaperPipeline in workflow.ts captures `expectedEpoch = job.runEpoch ?? 0`
 * at the start of a paper's batch. If the user paused + resumed mid-fanout,
 * job.runEpoch bumps to a higher value while the captured epoch stays at 0.
 * The per-question writes (recordOneAnswer) re-read the job and either skip
 * (workpool guard) or write at the new epoch. By the time the question batch
 * "completes" and runPaperPipeline calls finalizePaper with the captured
 * stale `expectedEpoch=0`, finalizePaper's matchesExpectedEpoch returned
 * false and silently no-op'd. Paper stuck in "extracting"; workflow exited
 * "success"; job never finalized.
 *
 * The fix: finalizePaper no longer takes an expectedEpoch arg. Paper-status
 * idempotency + the job's status-must-be-"extracting" gate are sufficient —
 * if the paper has actually rolled up to a terminal state, finalizing is
 * the right thing to do regardless of how many epoch bumps happened during
 * its fan-out.
 *
 * Tests are grouped:
 *   1. Regression: cross-epoch finalize completes the paper (and arg is rejected).
 *   2. Paper-level idempotency: every terminal paper status is a no-op.
 *   3. Job-state gating: every non-"extracting" job status blocks the flip.
 *   4. Aggregation outcomes: precedence of completed / failed / pending / retryable.
 *   5. pdfContentUsed propagation.
 *   6. creditsUsed preservation.
 *   7. maybeFinalizeJob cascade.
 */

import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { setupAggregates } from "./aggregates.test-support";
import { incPaperOutcome, readJobCounters } from "./jobCounters";

type JobStatusFixture =
  | "pending"
  | "downloading_pdfs"
  | "indexing"
  | "extracting"
  | "creditsExhausted"
  | "paused"
  | "cancelled"
  | "failed"
  | "completed";

type PaperStatusFixture =
  | "pending"
  | "extracting"
  | "completed"
  | "failed"
  | "download_failed"
  | "indexing_failed"
  | "skipped";

type ResultFixture = {
  questionKey: string;
  status: "completed" | "failed" | "pending";
  billed?: boolean;
  attemptCount?: number;
  lastErrorCode?: string;
  pdfContentUsed?: boolean;
};

interface SeedOpts {
  jobStatus?: JobStatusFixture;
  runEpoch?: number;
  paperStatus?: PaperStatusFixture;
  questionKeys?: string[];
  results?: ResultFixture[];
  totalPapers?: number;
  processedPapers?: number;
  failedPapers?: number;
  paperCreditsUsed?: number;
  paperQuestionsBilled?: boolean;
  startingCredits?: number;
  clerkSuffix?: string;
}

/**
 * Seed a single-paper job in a configurable state. Returns the ids the
 * test needs to drive finalizePaper and assert on the post-state.
 */
async function seedScenario(
  t: ReturnType<typeof convexTest>,
  opts: SeedOpts = {},
): Promise<{
  userId: Id<"users">;
  creditsId: Id<"credits">;
  jobId: Id<"extractionJobs">;
  paperId: Id<"extractionPapers">;
}> {
  const {
    jobStatus = "extracting",
    runEpoch,
    paperStatus = "extracting",
    questionKeys = ["q1"],
    results = [],
    totalPapers = 1,
    processedPapers = 0,
    failedPapers = 0,
    paperCreditsUsed,
    paperQuestionsBilled,
    startingCredits = 1_000,
    clerkSuffix = String(Math.random()).slice(2),
  } = opts;

  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: `clerk_fp_${clerkSuffix}`,
      email: `fp_${clerkSuffix}@test.com`,
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const creditsId = await ctx.db.insert("credits", {
      userId,
      freeBalance: 0,
      paidBalance: startingCredits,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: jobStatus,
      totalPapers,
      runEpoch,
      name: "FinalizePaper Edge Case Scenario",
      createdAt: now,
      updatedAt: now,
    });
    // Tier B: counters live in sharded counters off-row. Bump per request.
    for (let i = 0; i < processedPapers; i++) {
      await incPaperOutcome(ctx, jobId, true);
    }
    for (let i = 0; i < failedPapers; i++) {
      await incPaperOutcome(ctx, jobId, false);
    }
    for (let i = 0; i < questionKeys.length; i++) {
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: questionKeys[i],
        question: `Q ${questionKeys[i]}?`,
        type: "string" as const,
        order: i,
        createdAt: now,
      });
    }
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: `oa:fp_${clerkSuffix}`,
      title: "FinalizePaper Edge Case Paper",
      status: paperStatus,
      creditsUsed: paperCreditsUsed,
      questionsBilled: paperQuestionsBilled,
    });
    for (const r of results) {
      await ctx.db.insert("extractionResults", {
        jobId,
        paperId,
        questionKey: r.questionKey,
        answer: r.status === "completed" ? "ans" : null,
        confidence: r.status === "completed" ? 0.9 : 0,
        reasoning: r.status === "completed" ? "r" : `failed: ${r.questionKey}`,
        citations: [],
        citationStatus:
          r.status === "completed"
            ? ("grounded" as const)
            : ("extraction_error" as const),
        status: r.status,
        billed: r.billed ?? r.status === "completed",
        attemptCount: r.attemptCount ?? 1,
        pdfContentUsed: r.pdfContentUsed,
        lastError: r.lastErrorCode
          ? {
              code: r.lastErrorCode as never,
              message: "test error",
              at: now,
            }
          : undefined,
        processedAt: now,
      });
    }
    return { userId, creditsId, jobId, paperId };
  });
}

async function readBalance(
  t: ReturnType<typeof convexTest>,
  creditsId: Id<"credits">,
): Promise<number> {
  const row = await t.run((ctx) => ctx.db.get("credits", creditsId));
  return row!.paidBalance;
}

const finalizePaperRef =
  internal.extraction.mutations.results.finalizePaper;

// ─────────────────────────────────────────────────────────────────────
// 1. Regression: cross-epoch finalize completes the paper.
// ─────────────────────────────────────────────────────────────────────

describe("finalizePaper — cross-epoch regression (stuck-at-99% bug)", () => {
  it("rejects an extra expectedEpoch arg (the workflow caller must not pass it)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      jobStatus: "extracting",
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await expect(
      t.mutation(
        finalizePaperRef,
        // Pass an unknown field; the args validator must reject it so a
        // future regression that re-introduces the arg in workflow.ts
        // fails loud here instead of silently bailing in production.
        { paperId, expectedEpoch: 5 } as unknown as { paperId: Id<"extractionPapers"> },
      ),
    ).rejects.toThrow();
  });

  it("completes a paper whose results were written at the original epoch even after job.runEpoch advanced", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    // Simulates the post-pause-resume world: workflow originally booted at
    // runEpoch=0; a pause+resume cycle bumped it to 2 while the question
    // fan-out was in flight; questions finished at epoch=2; runPaperPipeline
    // still calls finalizePaper after the bump.
    const { jobId, paperId } = await seedScenario(t, {
      jobStatus: "extracting",
      runEpoch: 2,
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(paper?.status).toBe("completed");
    expect(paper?.completedAt).toBeDefined();
    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.status).toBe("completed");
    const counters = await t.run((ctx) => readJobCounters(ctx, jobId));
    expect(counters.processed).toBe(1);
  });

  it("completes a paper even when the job has been resumed many times (runEpoch=10)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedScenario(t, {
      jobStatus: "extracting",
      runEpoch: 10,
      questionKeys: ["q1", "q2", "q3"],
      results: [
        { questionKey: "q1", status: "completed", billed: true },
        { questionKey: "q2", status: "completed", billed: true },
        { questionKey: "q3", status: "completed", billed: true },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(paper?.status).toBe("completed");
    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.status).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Paper-level idempotency: every terminal paper status is a no-op.
// ─────────────────────────────────────────────────────────────────────

describe("finalizePaper — paper-level idempotency", () => {
  it.each([
    ["completed", "completed"],
    ["failed", "failed"],
    ["download_failed", "download_failed"],
    ["indexing_failed", "indexing_failed"],
  ] as const)(
    "no-op when paper is already %s (counter not double-bumped)",
    async (initial, expected) => {
      const t = convexTest(schema);
      setupAggregates(t);
      const { jobId, paperId } = await seedScenario(t, {
        paperStatus: initial,
        // Seed the counter as if markPaperTerminalTx already ran.
        processedPapers: initial === "completed" ? 1 : 0,
        failedPapers: initial === "completed" ? 0 : 1,
        results: [{ questionKey: "q1", status: "completed", billed: true }],
      });
      const before = await t.run((ctx) => readJobCounters(ctx, jobId));

      await t.mutation(finalizePaperRef, { paperId });

      const paper = await t.run((ctx) =>
        ctx.db.get("extractionPapers", paperId),
      );
      expect(paper?.status).toBe(expected);
      const after = await t.run((ctx) => readJobCounters(ctx, jobId));
      expect(after.processed).toBe(before.processed);
      expect(after.failed).toBe(before.failed);
    },
  );

  it("two consecutive finalizePaper calls bump counters exactly once", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedScenario(t, {
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await t.mutation(finalizePaperRef, { paperId });
    await t.mutation(finalizePaperRef, { paperId });

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    const counters = await t.run((ctx) => readJobCounters(ctx, jobId));
    expect(counters.processed).toBe(1);
    expect(counters.failed).toBe(0);
    // Sticky completed.
    expect(job?.status).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Job-state gating: only "extracting" jobs progress.
// ─────────────────────────────────────────────────────────────────────

describe("finalizePaper — job-state gating", () => {
  it.each([
    "pending",
    "downloading_pdfs",
    "indexing",
    "creditsExhausted",
    "paused",
    "cancelled",
    "failed",
    "completed",
  ] as const)(
    "no-op when parent job status is %s (paper stays extracting, no counter mutation)",
    async (jobStatus) => {
      const t = convexTest(schema);
      setupAggregates(t);
      const { jobId, paperId } = await seedScenario(t, {
        jobStatus,
        results: [{ questionKey: "q1", status: "completed", billed: true }],
      });
      const before = await t.run((ctx) => readJobCounters(ctx, jobId));

      await t.mutation(finalizePaperRef, { paperId });

      const paper = await t.run((ctx) =>
        ctx.db.get("extractionPapers", paperId),
      );
      // Paper stays in extracting — the guard short-circuits before
      // markPaperTerminalTx fires.
      expect(paper?.status).toBe("extracting");
      const after = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
      expect(after?.status).toBe(jobStatus);
      const afterCounters = await t.run((ctx) => readJobCounters(ctx, jobId));
      expect(afterCounters.processed).toBe(before.processed);
      expect(afterCounters.failed).toBe(before.failed);
    },
  );

  it("no-op when the paper has been deleted", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });
    await t.run((ctx) => ctx.db.delete(paperId));

    // Should resolve null, not throw.
    await expect(
      t.mutation(finalizePaperRef, { paperId }),
    ).resolves.toBeNull();
  });

  it("no-op when the parent job has been deleted (paper orphaned)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedScenario(t, {
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });
    await t.run((ctx) => ctx.db.delete(jobId));

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(paper?.status).toBe("extracting");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. Aggregation outcomes — precedence in aggregatePaperStatus.
// ─────────────────────────────────────────────────────────────────────

describe("finalizePaper — aggregation outcomes", () => {
  it("all results completed → paper completed", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      questionKeys: ["q1", "q2", "q3"],
      results: [
        { questionKey: "q1", status: "completed", billed: true },
        { questionKey: "q2", status: "completed", billed: true },
        { questionKey: "q3", status: "completed", billed: true },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("completed");
  });

  it("mix of completed + terminal failed (non-retryable) → paper completed (any success outweighs failures)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      questionKeys: ["q1", "q2"],
      results: [
        { questionKey: "q1", status: "completed", billed: true },
        {
          questionKey: "q2",
          status: "failed",
          billed: false,
          lastErrorCode: "pdf_invalid",
          attemptCount: 1,
        },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("completed");
  });

  it("all results terminal failed (non-retryable) → paper failed", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedScenario(t, {
      questionKeys: ["q1", "q2"],
      results: [
        {
          questionKey: "q1",
          status: "failed",
          billed: false,
          lastErrorCode: "pdf_invalid",
          attemptCount: 1,
        },
        {
          questionKey: "q2",
          status: "failed",
          billed: false,
          lastErrorCode: "pdf_invalid",
          attemptCount: 1,
        },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("failed");
    const counters = await t.run((ctx) => readJobCounters(ctx, jobId));
    expect(counters.processed).toBe(0);
    expect(counters.failed).toBe(1);
  });

  it("all results retryable failures with attempts exhausted → paper failed", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      questionKeys: ["q1", "q2"],
      results: [
        {
          questionKey: "q1",
          status: "failed",
          billed: false,
          lastErrorCode: "network",
          attemptCount: 3,
        },
        {
          questionKey: "q2",
          status: "failed",
          billed: false,
          lastErrorCode: "network",
          attemptCount: 3,
        },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("failed");
  });

  it("one retryable failure with budget remaining → no-op (paper stays extracting)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      questionKeys: ["q1", "q2"],
      results: [
        { questionKey: "q1", status: "completed", billed: true },
        {
          questionKey: "q2",
          status: "failed",
          billed: false,
          lastErrorCode: "network",
          attemptCount: 1,
        },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("extracting");
  });

  it("one question without a result row → no-op (rollup is pending)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      questionKeys: ["q1", "q2"],
      // Only q1 has a result row; q2 is missing.
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("extracting");
  });

  it("no results and no questions → no-op (rollup is pending)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      questionKeys: [],
      results: [],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("extracting");
  });

  it("classifies a failed-but-unclassified error as retryable by default → no-op until exhausted", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      questionKeys: ["q1"],
      results: [
        {
          questionKey: "q1",
          status: "failed",
          billed: false,
          // Intentionally no lastErrorCode → treated as retryable until cap.
          attemptCount: 1,
        },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("extracting");
  });

  it("an unclassified failure that hit the attempt cap flips paper to failed", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      questionKeys: ["q1"],
      results: [
        {
          questionKey: "q1",
          status: "failed",
          billed: false,
          attemptCount: 3,
        },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("failed");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. pdfContentUsed propagation.
// ─────────────────────────────────────────────────────────────────────

describe("finalizePaper — pdfContentUsed propagation", () => {
  it("propagates pdfContentUsed=true when any question used PDF content", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      questionKeys: ["q1", "q2"],
      results: [
        {
          questionKey: "q1",
          status: "completed",
          billed: true,
          pdfContentUsed: false,
        },
        {
          questionKey: "q2",
          status: "completed",
          billed: true,
          pdfContentUsed: true,
        },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.pdfContentUsed).toBe(true);
  });

  it("leaves pdfContentUsed undefined when no question used PDF content", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      questionKeys: ["q1", "q2"],
      results: [
        {
          questionKey: "q1",
          status: "completed",
          billed: true,
          pdfContentUsed: false,
        },
        {
          questionKey: "q2",
          status: "completed",
          billed: true,
          // pdfContentUsed deliberately omitted.
        },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.pdfContentUsed).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. creditsUsed preservation.
// ─────────────────────────────────────────────────────────────────────

describe("finalizePaper — creditsUsed preservation", () => {
  it("preserves the accumulated paper.creditsUsed when flipping to terminal", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    // Seed as if recordOneAnswer already credited 7 to paper.creditsUsed
    // via applyResultProjectionWrite — finalizePaper must keep that value.
    const { paperId } = await seedScenario(t, {
      paperCreditsUsed: 7,
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("completed");
    expect(paper?.creditsUsed).toBe(7);
  });

  it("leaves creditsUsed undefined when no per-question credits were spent", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedScenario(t, {
      results: [{ questionKey: "q1", status: "completed", billed: true }],
      // paperCreditsUsed deliberately omitted.
    });

    await t.mutation(finalizePaperRef, { paperId });

    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("completed");
    expect(paper?.creditsUsed).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. maybeFinalizeJob cascade.
// ─────────────────────────────────────────────────────────────────────

describe("finalizePaper — maybeFinalizeJob cascade", () => {
  it("flips job to completed when this is the only paper and it succeeded", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedScenario(t, {
      totalPapers: 1,
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.status).toBe("completed");
    const counters = await t.run((ctx) => readJobCounters(ctx, jobId));
    expect(counters.processed).toBe(1);
    expect(job?.completedAt).toBeDefined();
  });

  it("flips job to failed when this is the only paper and it failed", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperId } = await seedScenario(t, {
      totalPapers: 1,
      questionKeys: ["q1"],
      results: [
        {
          questionKey: "q1",
          status: "failed",
          billed: false,
          lastErrorCode: "pdf_invalid",
          attemptCount: 1,
        },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.status).toBe("failed");
    const counters = await t.run((ctx) => readJobCounters(ctx, jobId));
    expect(counters.processed).toBe(0);
    expect(counters.failed).toBe(1);
  });

  it("leaves job extracting when peer papers are still in flight", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    // Two papers total; only one finalized in this test. The job's counter
    // moves to 1/2 but maybeFinalizeJob does not flip.
    const { jobId, paperId } = await seedScenario(t, {
      totalPapers: 2,
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });
    // Seed the peer paper still in extracting.
    await t.run(async (ctx) => {
      await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: "oa:peer",
        title: "Peer paper",
        status: "extracting" as const,
      });
    });

    await t.mutation(finalizePaperRef, { paperId });

    const job = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(job?.status).toBe("extracting");
    const counters = await t.run((ctx) => readJobCounters(ctx, jobId));
    expect(counters.processed).toBe(1);
    expect(counters.failed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. Per-paper credit-debit semantics (new debit site).
//
// finalizePaper is now the one-and-only debit site for LLM-extraction
// credits (the per-question debit inside recordOneAnswer was removed
// to eliminate OCC-storm contention on the user's credits row). Every
// terminal flip with a non-zero paper.creditsUsed drains that amount
// from the wallet, gated on `paper.questionsBilled` so retries never
// double-charge.
// ─────────────────────────────────────────────────────────────────────

describe("finalizePaper — per-paper credit debit", () => {
  it("debits paper.creditsUsed from the wallet on terminal flip and sets questionsBilled", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { creditsId, jobId, paperId } = await seedScenario(t, {
      paperCreditsUsed: 7,
      startingCredits: 1_000,
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await t.mutation(finalizePaperRef, { paperId });

    expect(await readBalance(t, creditsId)).toBe(993);
    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("completed");
    expect(paper?.questionsBilled).toBe(true);
    expect(paper?.creditsUsed).toBe(7);
    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(1);
    expect(charges[0]?.amount).toBe(-7);
    expect(charges[0]?.billingType).toBe("extraction_llm");
    expect(charges[0]?.paperId).toBe(paperId);
  });

  it("debits accumulated credits even when the paper terminal status is failed (partial successes still cost)", async () => {
    // paper.creditsUsed only accumulates from successful per-question
    // billings — but a paper whose questions partially failed can still
    // have a non-zero accumulator. The terminal flip is `failed` (rollup
    // says so) yet the wallet must still be debited for the completed
    // work; otherwise users get unbilled LLM calls on partial failures.
    const t = convexTest(schema);
    setupAggregates(t);
    const { creditsId, jobId, paperId } = await seedScenario(t, {
      paperCreditsUsed: 4,
      startingCredits: 1_000,
      questionKeys: ["q1", "q2"],
      results: [
        {
          questionKey: "q1",
          status: "failed",
          billed: false,
          lastErrorCode: "pdf_invalid",
          attemptCount: 1,
        },
        {
          questionKey: "q2",
          status: "failed",
          billed: false,
          lastErrorCode: "pdf_invalid",
          attemptCount: 1,
        },
      ],
    });

    await t.mutation(finalizePaperRef, { paperId });

    expect(await readBalance(t, creditsId)).toBe(996);
    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("failed");
    expect(paper?.questionsBilled).toBe(true);
    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(1);
    expect(charges[0]?.amount).toBe(-4);
  });

  it("does NOT debit when paper.questionsBilled is already true (workflow retry idempotency)", async () => {
    // Seeds a paper that already carries questionsBilled=true (a prior
    // run already paid the bill). The terminal flip happens, but the
    // wallet is untouched.
    const t = convexTest(schema);
    setupAggregates(t);
    const { creditsId, jobId, paperId } = await seedScenario(t, {
      paperCreditsUsed: 5,
      paperQuestionsBilled: true,
      startingCredits: 1_000,
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await t.mutation(finalizePaperRef, { paperId });

    expect(await readBalance(t, creditsId)).toBe(1_000);
    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("completed");
    expect(paper?.questionsBilled).toBe(true);
    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(0);
  });

  it("does NOT debit and does NOT flip questionsBilled when paper.creditsUsed is zero", async () => {
    // Zero-credit guard short-circuits before deductCreditsTransaction
    // would throw INVALID_AMOUNT on a zero-amount debit. questionsBilled
    // stays unset so a downstream resume that records real cost can
    // still charge.
    const t = convexTest(schema);
    setupAggregates(t);
    const { creditsId, jobId, paperId } = await seedScenario(t, {
      paperCreditsUsed: 0,
      startingCredits: 1_000,
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await t.mutation(finalizePaperRef, { paperId });

    expect(await readBalance(t, creditsId)).toBe(1_000);
    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("completed");
    expect(paper?.questionsBilled).toBeUndefined();
    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(0);
  });

  it("does NOT debit when paper.creditsUsed is undefined (never accumulated)", async () => {
    // paperCreditsUsed omitted at seed time → field is undefined.
    // creditsToDebit = (undefined ?? 0) === 0, guard skips.
    const t = convexTest(schema);
    setupAggregates(t);
    const { creditsId, jobId, paperId } = await seedScenario(t, {
      startingCredits: 1_000,
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await t.mutation(finalizePaperRef, { paperId });

    expect(await readBalance(t, creditsId)).toBe(1_000);
    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("completed");
    expect(paper?.questionsBilled).toBeUndefined();
    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(0);
  });

  it("drains the wallet (allowPartial:true) when balance < paper.creditsUsed instead of throwing", async () => {
    // The contract is `allowPartial:true` — if the wallet ran short
    // mid-run, finalizePaper must drain the remaining balance and let
    // the cascade transition the job to creditsExhausted upstream.
    // Throwing INSUFFICIENT_CREDITS here would mean a successfully-
    // extracted paper stays in "extracting" forever.
    const t = convexTest(schema);
    setupAggregates(t);
    const { creditsId, jobId, paperId } = await seedScenario(t, {
      paperCreditsUsed: 10,
      startingCredits: 3,
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await t.mutation(finalizePaperRef, { paperId });

    expect(await readBalance(t, creditsId)).toBe(0);
    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.status).toBe("completed");
    expect(paper?.questionsBilled).toBe(true);
    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(1);
    expect(charges[0]?.amount).toBe(-3);
  });

  it("calling finalizePaper twice with non-zero credits debits exactly once (terminal short-circuit)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { creditsId, jobId, paperId } = await seedScenario(t, {
      paperCreditsUsed: 6,
      startingCredits: 1_000,
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await t.mutation(finalizePaperRef, { paperId });
    await t.mutation(finalizePaperRef, { paperId });

    expect(await readBalance(t, creditsId)).toBe(994);
    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(1);
  });
});
