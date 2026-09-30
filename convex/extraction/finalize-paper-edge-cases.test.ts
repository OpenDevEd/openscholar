/**
 * finalizePaper edge-case suite.
 *
 * Background — the stuck-at-99% bug:
 * The old paper runner captured `expectedEpoch = job.runEpoch ?? 0` at the
 * start of a paper's batch. If the user paused + resumed mid-fanout,
 * job.runEpoch bumped to a higher value while the captured epoch stayed at 0.
 * The result batch write re-reads the job and either skips or writes at
 * the new epoch. By the time the question batch completes and the worker
 * calls finalizePaper with the captured
 * stale `expectedEpoch=0`, finalizePaper's matchesExpectedEpoch returned
 * false and silently no-op'd. Paper stuck in "extracting"; the worker
 * returned success; job never finalized.
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
import {
  seedCreditsForTest,
} from "../billing/billing.test-support";
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
  // Tier C: per-question creditsUsed lives on the extractionResults row.
  // finalizePaper sums these to compute the per-paper wallet debit.
  creditsUsed?: number;
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
    await seedCreditsForTest(ctx, {
      userId,
      free: 0,
      paid: startingCredits,
      now,
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
        creditsUsed: r.creditsUsed,
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
    return { userId, jobId, paperId };
  });
}

const finalizePaperRef =
  internal.extraction.mutations.results.finalizePaper;

// ─────────────────────────────────────────────────────────────────────
// 1. Regression: cross-epoch finalize completes the paper.
// ─────────────────────────────────────────────────────────────────────

describe("finalizePaper — cross-epoch regression (stuck-at-99% bug)", () => {
  it("rejects an extra expectedEpoch arg", async () => {
    const t = convexTest(schema);
    const { paperId } = await seedScenario(t, {
      jobStatus: "extracting",
      results: [{ questionKey: "q1", status: "completed", billed: true }],
    });

    await expect(
      t.mutation(
        finalizePaperRef,
        // Pass an unknown field; the args validator must reject it so a
        // future regression that re-introduces the arg
        // fails loud here instead of silently bailing in production.
        { paperId, expectedEpoch: 5 } as unknown as { paperId: Id<"extractionPapers"> },
      ),
    ).rejects.toThrow();
  });

  it("completes a paper whose results were written at the original epoch even after job.runEpoch advanced", async () => {
    const t = convexTest(schema);
    // Simulates the post-pause-resume world: work started at runEpoch=0;
    // a pause+resume cycle bumped it to 2 while question fan-out was in
    // flight; questions finished at epoch=2; finalization still runs
    // after the bump.
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
  it("preserves the accumulated per-question creditsUsed on the paper-row terminal copy", async () => {
    const t = convexTest(schema);
    // Tier C: the per-question creditsUsed lives on the extractionResults
    // row. finalizePaper sums them and writes the total onto the paper
    // row via markPaperTerminalTx as the terminal-time copy for the UI.
    const { paperId } = await seedScenario(t, {
      results: [
        { questionKey: "q1", status: "completed", billed: true, creditsUsed: 7 },
      ],
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
    const { paperId } = await seedScenario(t, {
      results: [{ questionKey: "q1", status: "completed", billed: true }],
      // result.creditsUsed deliberately omitted — sum=0 → finalize passes
      // creditsUsed:undefined to markPaperTerminalTx so the field stays
      // unset.
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
