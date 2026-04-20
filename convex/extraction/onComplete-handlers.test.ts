import { convexTest } from "convex-test";
import { describe, test, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { setupAggregates } from "./aggregates.test-support";

/**
 * Safety net SN-4 (P3 plan): pin the workpool onComplete dispatchers.
 * Three RunResult branches × two handlers, plus terminal-state idempotency.
 *
 * Handlers are `pdfProcessingPool.defineOnComplete({...})` — under the
 * hood each is an internalMutation with args `{workId, context, result}`,
 * so we drive them directly through convex-test without needing the
 * workpool component registered.
 *
 * Invariants pinned:
 *   1. Paper terminal status transition (failed / download_failed).
 *   2. Job.failedPapers counter bump on the first transition to terminal.
 *   3. No counter double-bump when a terminal paper is re-fired.
 *   4. No status resurrection — a terminal paper stays terminal.
 *
 * The success-with-data.success=true branch of handleDownloadAndIndexComplete
 * is intentionally out of scope: it calls pdfProcessingPool.enqueueAction,
 * which needs the workpool component registered. handleExtractionComplete's
 * equivalent branch (onSuccess → saveExtractionResultsAndComplete) is a
 * plain ctx.runMutation and is covered.
 */

async function seedDownloadingPaper(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_onComplete",
      email: "oc@test.com",
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      totalPapers: 1,
      processedPapers: 0,
      failedPapers: 0,
      name: "onComplete pin-test",
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:oc1",
      title: "Paper under test",
      status: "downloading" as const,
      processable: true,
    });
    return { userId, jobId, paperId };
  });
}

async function readPaperAndJob(
  t: ReturnType<typeof convexTest>,
  ids: { jobId: string; paperId: string }
) {
  return await t.run(async (ctx) => {
    const paper = await ctx.db.get(
      "extractionPapers",
      ids.paperId as never
    );
    const job = await ctx.db.get("extractionJobs", ids.jobId as never);
    return { paper, job };
  });
}

// A fabricated WorkId. The workpool types use a branded string; casting
// through unknown keeps us in the dispatcher's internal mutation path
// without dragging in the component.
const FAKE_WORK_ID = "work_fake" as never;
const DOWNLOAD_QUESTIONS: ReadonlyArray<{
  key: string;
  question: string;
  type: "string";
}> = [{ key: "q1", question: "test?", type: "string" }];

describe("SN-4 handleDownloadAndIndexComplete branches", () => {
  test("success with data.success=false → paper download_failed, failedPapers++", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const ids = await seedDownloadingPaper(t);
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleDownloadAndIndexComplete,
      {
        workId: FAKE_WORK_ID,
        context: {
          paperId: ids.paperId,
          jobId: ids.jobId,
          questions: DOWNLOAD_QUESTIONS,
        },
        result: {
          kind: "success" as const,
          returnValue: {
            success: false,
            error: {
              code: "pdf_download_failed",
              message: "pdf host 404",
              retryable: true,
            },
          },
        },
      } as never
    );
    const { paper, job } = await readPaperAndJob(t, ids);
    expect(paper?.status).toBe("download_failed");
    expect(job?.failedPapers).toBe(1);
    expect(job?.processedPapers).toBe(0);
    // Plan-01: per-paper error history is appended on every terminal failure
    expect(paper?.lastError?.code).toBe("pdf_download_failed");
    expect(paper?.attemptCount).toBe(1);
    const errors = await t.run((ctx) =>
      ctx.db
        .query("extractionPaperErrors")
        .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId as never))
        .collect(),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("pdf_download_failed");
    expect(errors[0].attempt).toBe(1);
  });

  test("failed → paper failed, failedPapers++", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const ids = await seedDownloadingPaper(t);
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleDownloadAndIndexComplete,
      {
        workId: FAKE_WORK_ID,
        context: {
          paperId: ids.paperId,
          jobId: ids.jobId,
          questions: DOWNLOAD_QUESTIONS,
        },
        result: { kind: "failed" as const, error: "runtime crash" },
      } as never
    );
    const { paper, job } = await readPaperAndJob(t, ids);
    expect(paper?.status).toBe("failed");
    expect(job?.failedPapers).toBe(1);
  });

  test("canceled → paper failed, failedPapers++", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const ids = await seedDownloadingPaper(t);
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleDownloadAndIndexComplete,
      {
        workId: FAKE_WORK_ID,
        context: {
          paperId: ids.paperId,
          jobId: ids.jobId,
          questions: DOWNLOAD_QUESTIONS,
        },
        result: { kind: "canceled" as const },
      } as never
    );
    const { paper, job } = await readPaperAndJob(t, ids);
    expect(paper?.status).toBe("failed");
    expect(job?.failedPapers).toBe(1);
  });
});

describe("SN-4 handleExtractionComplete branches", () => {
  test("success with data.success=true → saveExtractionResultsAndComplete runs, paper completed", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const ids = await seedDownloadingPaper(t);
    // Move paper to extracting (the natural predecessor to this handler).
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "extractionPapers",
        ids.paperId as never,
        { status: "extracting" }
      );
    });
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleExtractionComplete,
      {
        workId: FAKE_WORK_ID,
        context: { paperId: ids.paperId, jobId: ids.jobId },
        result: {
          kind: "success" as const,
          returnValue: {
            success: true,
            results: [],
            creditsUsed: 0,
            pdfContentUsed: false,
          },
        },
      } as never
    );
    const { paper, job } = await readPaperAndJob(t, ids);
    expect(paper?.status).toBe("completed");
    expect(job?.processedPapers).toBe(1);
    expect(job?.failedPapers).toBe(0);
  });

  test("success with data.success=false → paper failed, failedPapers++", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const ids = await seedDownloadingPaper(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "extractionPapers",
        ids.paperId as never,
        { status: "extracting" }
      );
    });
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleExtractionComplete,
      {
        workId: FAKE_WORK_ID,
        context: { paperId: ids.paperId, jobId: ids.jobId },
        result: {
          kind: "success" as const,
          returnValue: {
            success: false,
            error: {
              code: "schema_validation",
              message: "LLM error",
              retryable: false,
            },
          },
        },
      } as never
    );
    const { paper, job } = await readPaperAndJob(t, ids);
    expect(paper?.status).toBe("failed");
    expect(job?.failedPapers).toBe(1);
    // Plan-01: structured error + history row + attempt counter
    expect(paper?.lastError?.code).toBe("schema_validation");
    expect(paper?.attemptCount).toBe(1);
    const errors = await t.run((ctx) =>
      ctx.db
        .query("extractionPaperErrors")
        .withIndex("by_paper", (q) => q.eq("paperId", ids.paperId as never))
        .collect(),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("schema_validation");
  });

  test("failed → paper failed, failedPapers++", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const ids = await seedDownloadingPaper(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "extractionPapers",
        ids.paperId as never,
        { status: "extracting" }
      );
    });
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleExtractionComplete,
      {
        workId: FAKE_WORK_ID,
        context: { paperId: ids.paperId, jobId: ids.jobId },
        result: { kind: "failed" as const, error: "crash" },
      } as never
    );
    const { paper, job } = await readPaperAndJob(t, ids);
    expect(paper?.status).toBe("failed");
    expect(job?.failedPapers).toBe(1);
  });

  test("canceled → paper failed, failedPapers++", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const ids = await seedDownloadingPaper(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "extractionPapers",
        ids.paperId as never,
        { status: "extracting" }
      );
    });
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleExtractionComplete,
      {
        workId: FAKE_WORK_ID,
        context: { paperId: ids.paperId, jobId: ids.jobId },
        result: { kind: "canceled" as const },
      } as never
    );
    const { paper, job } = await readPaperAndJob(t, ids);
    expect(paper?.status).toBe("failed");
    expect(job?.failedPapers).toBe(1);
  });
});

describe("SN-4 terminal-state idempotency", () => {
  test("already-failed paper re-fired by handleDownloadAndIndexComplete → no second counter bump", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const ids = await seedDownloadingPaper(t);
    // First fire: transition to failed + bump.
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleDownloadAndIndexComplete,
      {
        workId: FAKE_WORK_ID,
        context: {
          paperId: ids.paperId,
          jobId: ids.jobId,
          questions: DOWNLOAD_QUESTIONS,
        },
        result: { kind: "failed" as const, error: "first crash" },
      } as never
    );
    const mid = await readPaperAndJob(t, ids);
    expect(mid.paper?.status).toBe("failed");
    expect(mid.job?.failedPapers).toBe(1);

    // Second fire (late canceled): paper stays failed, job counter unchanged.
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleDownloadAndIndexComplete,
      {
        workId: FAKE_WORK_ID,
        context: {
          paperId: ids.paperId,
          jobId: ids.jobId,
          questions: DOWNLOAD_QUESTIONS,
        },
        result: { kind: "canceled" as const },
      } as never
    );
    const after = await readPaperAndJob(t, ids);
    expect(after.paper?.status).toBe("failed");
    expect(after.job?.failedPapers).toBe(1);
  });

  test("already-completed paper re-fired by handleExtractionComplete → no resurrection, no extra bump", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const ids = await seedDownloadingPaper(t);
    // Seed paper in terminal completed and counter already reflecting it.
    await t.run(async (ctx) => {
      await ctx.db.patch(
        "extractionPapers",
        ids.paperId as never,
        { status: "completed", extractionBilled: true }
      );
      await ctx.db.patch("extractionJobs", ids.jobId as never, {
        processedPapers: 1,
      });
    });
    // Re-fire with a failed RunResult.
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleExtractionComplete,
      {
        workId: FAKE_WORK_ID,
        context: { paperId: ids.paperId, jobId: ids.jobId },
        result: { kind: "failed" as const, error: "late error" },
      } as never
    );
    const after = await readPaperAndJob(t, ids);
    expect(after.paper?.status).toBe("completed");
    expect(after.job?.processedPapers).toBe(1);
    expect(after.job?.failedPapers).toBe(0);
  });
});

/**
 * Workflow-level onComplete: the framework-guaranteed job-failure safety
 * net. Pins the three RunResult branches plus terminal-state idempotency
 * for `handleExtractionJobComplete`.
 */
const FAKE_WORKFLOW_ID = "workflow_fake" as never;

async function seedDownloadingJob(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_workflow_onComplete",
      email: "wfoc@test.com",
      firstName: "Test",
      lastName: "User",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      // Typical workflow-failure condition: status was advanced past
      // `pending` before the handler threw.
      status: "downloading_pdfs" as const,
      totalPapers: 0,
      processedPapers: 0,
      failedPapers: 0,
      name: "workflow onComplete pin-test",
      createdAt: now,
      updatedAt: now,
    });
    return { userId, jobId };
  });
}

describe("handleExtractionJobComplete", () => {
  test("failed result → patches job to failed with structured error", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedDownloadingJob(t);
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleExtractionJobComplete,
      {
        workflowId: FAKE_WORKFLOW_ID,
        context: { jobId },
        result: { kind: "failed" as const, error: "VALIDATION_ERROR: No sources selected" },
      } as never
    );
    const job = await t.run((ctx) =>
      ctx.db.get("extractionJobs", jobId as never)
    );
    expect(job?.status).toBe("failed");
    expect(job?.error?.message).toBe("VALIDATION_ERROR: No sources selected");
    expect(typeof job?.error?.code).toBe("string");
    expect(typeof job?.error?.at).toBe("number");
  });

  test("success result → no job-status change", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedDownloadingJob(t);
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleExtractionJobComplete,
      {
        workflowId: FAKE_WORKFLOW_ID,
        context: { jobId },
        result: { kind: "success" as const, returnValue: null },
      } as never
    );
    const job = await t.run((ctx) =>
      ctx.db.get("extractionJobs", jobId as never)
    );
    // Workflow handler owns the `extracting → completed` transition via
    // paper-level onCompletes; this handler must not touch it.
    expect(job?.status).toBe("downloading_pdfs");
    expect(job?.error).toBeUndefined();
  });

  test("canceled result → no-op (cancelExtraction already wrote cancelled)", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedDownloadingJob(t);
    // Mirror cancelExtraction's effect before the workflow's onComplete fires.
    await t.run((ctx) =>
      ctx.db.patch("extractionJobs", jobId as never, { status: "cancelled" })
    );
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleExtractionJobComplete,
      {
        workflowId: FAKE_WORKFLOW_ID,
        context: { jobId },
        result: { kind: "canceled" as const },
      } as never
    );
    const job = await t.run((ctx) =>
      ctx.db.get("extractionJobs", jobId as never)
    );
    expect(job?.status).toBe("cancelled");
    expect(job?.error).toBeUndefined();
  });

  test("failed result on already-terminal job → does not overwrite status or error", async () => {
    const t = convexTest(schema);
    const { jobId } = await seedDownloadingJob(t);
    await t.run((ctx) =>
      ctx.db.patch("extractionJobs", jobId as never, {
        status: "cancelled",
      })
    );
    await t.mutation(
      internal.extraction.mutations.internal.onComplete.handleExtractionJobComplete,
      {
        workflowId: FAKE_WORKFLOW_ID,
        context: { jobId },
        result: { kind: "failed" as const, error: "late failure" },
      } as never
    );
    const job = await t.run((ctx) =>
      ctx.db.get("extractionJobs", jobId as never)
    );
    expect(job?.status).toBe("cancelled");
    expect(job?.error).toBeUndefined();
  });

  test("deleted job → no throw, no side effects", async () => {
    // Simulates the job being deleted between workflow start and
    // onComplete firing. A real workflowId + real (now-deleted) jobId.
    const t = convexTest(schema);
    const { jobId } = await seedDownloadingJob(t);
    await t.run((ctx) => ctx.db.delete("extractionJobs", jobId as never));
    await expect(
      t.mutation(
        internal.extraction.mutations.internal.onComplete.handleExtractionJobComplete,
        {
          workflowId: FAKE_WORKFLOW_ID,
          context: { jobId },
          result: { kind: "failed" as const, error: "whatever" },
        } as never
      )
    ).resolves.toBeNull();
  });
});
