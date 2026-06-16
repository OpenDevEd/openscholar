/**
 * Plan-05 — retryFailedQuestions + applyRetryResetTx behavior tests.
 *
 * Split rationale:
 *  - The public mutation dispatches retry queue rows on the happy path.
 *    Tests covering state changes (result resets, paper flips,
 *    job un-terminal) invoke the tx-only helper
 *    `applyRetryResetTx` via `t.run(…)`, which commits.
 *  - Tests covering auth / ownership / preconditions / preflight
 *    invoke the public mutation and assert on rejection shape.
 */

import { convexTest, type TestConvex } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import type { Doc, Id } from "../../_generated/dataModel";
import { applyRetryResetTx } from "./retry";
import {
  setupTransactionAggregates,
  seedCreditsForTest,
} from "../../credits/aggregates.test-support";
import { setupExtractionPaperWorkpool } from "../queue/workpool.test-support";

const CLERK = "clerk_retry_mutation_owner";
const OWNER_IDENTITY = {
  subject: CLERK,
  tokenIdentifier: `${CLERK}|test`,
};
type ExtractionTest = TestConvex<typeof schema>;

async function seedFlagsAndCredits(
  t: ReturnType<typeof convexTest>,
  opts: { paid?: number; free?: number } = {},
): Promise<{ userId: Id<"users">; creditsId: Id<"credits"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK,
      email: "retry@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.enabled",
      enabled: true,
      minimumTier: 0,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.start",
      enabled: true,
      minimumTier: 0,
      updatedAt: now,
    });
    const creditsId = await seedCreditsForTest(ctx, {
      userId,
      free: opts.free ?? 0,
      paid: opts.paid ?? 100_000,
      now,
    });
    return { userId, creditsId };
  });
}

type SeedOptions = {
  jobStatus?:
    | "completed"
    | "failed"
    | "creditsExhausted"
    | "extracting"
    | "pending";
  paperStatus?: "completed" | "failed" | "extracting";
  runEpoch?: number;
  /** Shape: a list of failure codes to seed; each gets its own result row.
   *  `completed` entries produce billed completed rows. `billedRetryable`
   *  produces a failed row with billed=true (should NEVER be reset). */
  rows: Array<
    | { kind: "completed"; key: string }
    | {
        kind: "failed";
        key: string;
        code:
          | "rate_limit"
          | "network"
          | "pdf_invalid"
          | "moderation"
          | "insufficient_credits";
      }
    | { kind: "billedRetryable"; key: string }
  >;
};

async function seedJob(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  opts: SeedOptions,
): Promise<{ jobId: Id<"extractionJobs">; paperId: Id<"extractionPapers"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      name: "Retry Test Job",
      sourceType: "history" as const,
      status: opts.jobStatus ?? "completed",
      totalPapers: 1,
      runEpoch: opts.runEpoch ?? 0,
      usePdfs: false,
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:retry_paper_1",
      title: "Paper 1",
      status: opts.paperStatus ?? "completed",
      indexingBilled: true,
      ragEntryId: "rag:1",
      isIndexed: true,
    });

    for (const row of opts.rows) {
      if (row.kind === "completed") {
        await ctx.db.insert("extractionResults", {
          jobId,
          paperId,
          questionKey: row.key,
          answer: "ok",
          citations: [],
          citationStatus: "grounded" as const,
          status: "completed" as const,
          billed: true,
          attemptCount: 1,
          processedAt: now,
        });
      } else if (row.kind === "failed") {
        await ctx.db.insert("extractionResults", {
          jobId,
          paperId,
          questionKey: row.key,
          answer: null,
          citations: [],
          citationStatus: "extraction_error" as const,
          status: "failed" as const,
          billed: false,
          attemptCount: 1,
          lastError: { code: row.code, message: row.code, at: now },
          processedAt: now,
        });
      } else {
        // billedRetryable: the anomalous case — plan-05 must skip.
        await ctx.db.insert("extractionResults", {
          jobId,
          paperId,
          questionKey: row.key,
          answer: "partial",
          citations: [],
          citationStatus: "extraction_error" as const,
          status: "failed" as const,
          billed: true,
          attemptCount: 1,
          lastError: { code: "rate_limit", message: "429", at: now },
          processedAt: now,
        });
      }
    }
    return { jobId, paperId };
  });
}

async function retryAndReadQueuedWork(
  t: ExtractionTest,
  jobId: Id<"extractionJobs">,
): Promise<{
  result: { retryableCount: number; queued: number; dispatched: number };
  job: Doc<"extractionJobs"> | null;
  queueRows: Array<Doc<"extractionPaperQueue">>;
  retryRows: Array<Doc<"extractionResults">>;
}> {
  const auth = t.withIdentity(OWNER_IDENTITY);
  const result = await auth.mutation(
    api.extraction.mutations.retry.retryFailedQuestions,
    { jobId },
  );
  const [job, queueRows, retryRows] = await t.run(async (ctx) => {
    return await Promise.all([
      ctx.db.get(jobId),
      ctx.db
        .query("extractionPaperQueue")
        .withIndex("by_job_and_epoch_and_status", (q) =>
          q.eq("jobId", jobId).eq("runEpoch", 1).eq("status", "leased"),
        )
        .collect(),
      ctx.db
        .query("extractionResults")
        .withIndex("by_job_status", (q) =>
          q.eq("jobId", jobId).eq("status", "pending"),
        )
        .collect(),
    ]);
  });
  return { result, job, queueRows, retryRows };
}

describe("applyRetryResetTx — state changes", () => {
  it("resets only retryable failures; leaves permanents, completed, and billed rows untouched", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedFlagsAndCredits(t, { paid: 100_000 });
    const { jobId, paperId } = await seedJob(t, userId, {
      jobStatus: "completed",
      paperStatus: "completed",
      rows: [
        { kind: "completed", key: "q_done_1" },
        { kind: "completed", key: "q_done_2" },
        { kind: "failed", key: "q_rate_1", code: "rate_limit" },
        { kind: "failed", key: "q_rate_2", code: "rate_limit" },
        { kind: "failed", key: "q_network", code: "network" },
        { kind: "failed", key: "q_pdf", code: "pdf_invalid" },
        { kind: "failed", key: "q_mod", code: "moderation" },
        { kind: "billedRetryable", key: "q_billed_bug" },
      ],
    });

    const retryableCount = await t.run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      if (!job) throw new Error("job disappeared");
      return await applyRetryResetTx(ctx, job);
    });

    // 3 retryable: 2× rate_limit + 1× network.
    expect(retryableCount).toBe(3);

    // Inspect every row and assert the invariants.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    const byKey = new Map(rows.map((r) => [r.questionKey, r]));

    // Retryable flips: status=pending, lastError cleared, billed still false.
    for (const key of ["q_rate_1", "q_rate_2", "q_network"]) {
      const row = byKey.get(key);
      expect(row?.status).toBe("pending");
      expect(row?.lastError).toBeUndefined();
      expect(row?.billed).toBe(false);
    }

    // Permanent failures stay as-is.
    for (const key of ["q_pdf", "q_mod"]) {
      const row = byKey.get(key);
      expect(row?.status).toBe("failed");
      expect(row?.lastError?.code).toBeTruthy();
    }

    // Completed rows untouched.
    for (const key of ["q_done_1", "q_done_2"]) {
      const row = byKey.get(key);
      expect(row?.status).toBe("completed");
      expect(row?.billed).toBe(true);
    }

    // The billed-but-failed anomaly row MUST be skipped (would re-bill).
    const billedBug = byKey.get("q_billed_bug");
    expect(billedBug?.status).toBe("failed");
    expect(billedBug?.billed).toBe(true);

    // Paper un-terminaled.
    const paper = await t.run((ctx) => ctx.db.get(paperId));
    expect(paper?.status).toBe("extracting");
    expect(paper?.completedAt).toBeUndefined();
    // indexingBilled stays true (never re-index on retry).
    expect(paper?.indexingBilled).toBe(true);

    // Job un-terminaled, error cleared.
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("extracting");
    expect(job?.runEpoch).toBe(1);
    expect(job?.error).toBeUndefined();
    expect(job?.completedAt).toBeUndefined();
  });

  it("returns 0 and makes no changes when the job has only permanent failures", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedFlagsAndCredits(t);
    const { jobId, paperId } = await seedJob(t, userId, {
      jobStatus: "completed",
      paperStatus: "completed",
      rows: [
        { kind: "completed", key: "q1" },
        { kind: "failed", key: "q_pdf", code: "pdf_invalid" },
        { kind: "failed", key: "q_mod", code: "moderation" },
      ],
    });

    const count = await t.run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      if (!job) throw new Error("job disappeared");
      return await applyRetryResetTx(ctx, job);
    });

    expect(count).toBe(0);
    // Job status unchanged.
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("completed");
    const paper = await t.run((ctx) => ctx.db.get(paperId));
    expect(paper?.status).toBe("completed");
  });

  it("un-terminals creditsExhausted → extracting (plan-03 resume path)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedFlagsAndCredits(t);
    const { jobId } = await seedJob(t, userId, {
      jobStatus: "creditsExhausted",
      paperStatus: "failed",
      rows: [{ kind: "failed", key: "q1", code: "insufficient_credits" }],
    });

    const count = await t.run(async (ctx) => {
      const job = await ctx.db.get(jobId);
      if (!job) throw new Error("job disappeared");
      return await applyRetryResetTx(ctx, job);
    });

    expect(count).toBe(1);
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("extracting");
    expect(job?.runEpoch).toBe(1);
  });
});

describe("retryFailedQuestions — public mutation guards", () => {
  it("rejects unauthenticated callers", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedFlagsAndCredits(t);
    const { jobId } = await seedJob(t, userId, {
      rows: [{ kind: "failed", key: "q1", code: "rate_limit" }],
    });
    await expect(
      t.mutation(api.extraction.mutations.retry.retryFailedQuestions, {
        jobId,
      }),
    ).rejects.toThrow();
  });

  it("rejects callers who don't own the job (no existence leak)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedFlagsAndCredits(t);
    const { jobId } = await seedJob(t, userId, {
      rows: [{ kind: "failed", key: "q1", code: "rate_limit" }],
    });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        clerkId: "clerk_retry_other",
        email: "other@test.com",
        state: "active" as const,
        createdAt: now,
        updatedAt: now,
      });
    });
    const foreign = t.withIdentity({
      subject: "clerk_retry_other",
      tokenIdentifier: "clerk_retry_other|test",
    });
    await expect(
      foreign.mutation(api.extraction.mutations.retry.retryFailedQuestions, {
        jobId,
      }),
    ).rejects.toThrow(/NOT_FOUND|not found/i);
  });

  it("rejects retry on a non-extraction (chat) job", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedFlagsAndCredits(t);
    const jobId = await t.run((ctx) =>
      ctx.db.insert("extractionJobs", {
        userId,
        mode: "chat" as const,
        name: "Chat Job",
        messageCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const auth = t.withIdentity(OWNER_IDENTITY);
    await expect(
      auth.mutation(api.extraction.mutations.retry.retryFailedQuestions, {
        jobId,
      }),
    ).rejects.toThrow(/extraction/i);
  });

  it("rejects retry on a job in an active status (pending/extracting)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedFlagsAndCredits(t);
    const { jobId } = await seedJob(t, userId, {
      jobStatus: "extracting",
      paperStatus: "extracting",
      rows: [{ kind: "failed", key: "q1", code: "rate_limit" }],
    });
    const auth = t.withIdentity(OWNER_IDENTITY);
    await expect(
      auth.mutation(api.extraction.mutations.retry.retryFailedQuestions, {
        jobId,
      }),
    ).rejects.toThrow(/status extracting|Cannot retry/i);
  });

  it("rejects with 'nothing to retry' when only permanent failures exist", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedFlagsAndCredits(t);
    const { jobId } = await seedJob(t, userId, {
      rows: [
        { kind: "failed", key: "q_pdf", code: "pdf_invalid" },
        { kind: "failed", key: "q_mod", code: "moderation" },
      ],
    });
    const auth = t.withIdentity(OWNER_IDENTITY);
    await expect(
      auth.mutation(api.extraction.mutations.retry.retryFailedQuestions, {
        jobId,
      }),
    ).rejects.toThrow(/No retryable/i);
  });

  it("rejects with INSUFFICIENT_CREDITS when balance < retry estimate.high; no state changes", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    const { userId } = await seedFlagsAndCredits(t, { paid: 0 });
    const { jobId, paperId } = await seedJob(t, userId, {
      jobStatus: "completed",
      paperStatus: "completed",
      rows: [
        { kind: "failed", key: "q_rate", code: "rate_limit" },
        { kind: "failed", key: "q_net", code: "network" },
      ],
    });
    const auth = t.withIdentity(OWNER_IDENTITY);

    await expect(
      auth.mutation(api.extraction.mutations.retry.retryFailedQuestions, {
        jobId,
      }),
    ).rejects.toThrow(/INSUFFICIENT_CREDITS|credits/i);

    // State unchanged.
    const job = await t.run((ctx) => ctx.db.get(jobId));
    expect(job?.status).toBe("completed");
    const paper = await t.run((ctx) => ctx.db.get(paperId));
    expect(paper?.status).toBe("completed");
    const rows = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(rows.every((r) => r.status === "failed")).toBe(true);
  });

  it("enqueues retry queue work on the happy path", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupExtractionPaperWorkpool(t);
    const { userId } = await seedFlagsAndCredits(t, { paid: 100_000 });
    const { jobId } = await seedJob(t, userId, {
      jobStatus: "completed",
      paperStatus: "completed",
      rows: [
        { kind: "completed", key: "q_done" },
        { kind: "failed", key: "q_rate", code: "rate_limit" },
      ],
    });
    const { result, job, queueRows, retryRows } = await retryAndReadQueuedWork(
      t,
      jobId,
    );

    expect(result.retryableCount).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.dispatched).toBe(1);
    expect(job?.status).toBe("extracting");
    expect(job?.runEpoch).toBe(1);
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0].kind).toBe("retry");
    expect(queueRows[0].questionKeys).toEqual(["q_rate"]);
    expect(retryRows.map((row) => row.questionKey)).toEqual(["q_rate"]);
  });

  it("allows retry on status=failed", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupExtractionPaperWorkpool(t);
    const { userId } = await seedFlagsAndCredits(t, { paid: 100_000 });
    const { jobId } = await seedJob(t, userId, {
      jobStatus: "failed",
      paperStatus: "failed",
      rows: [{ kind: "failed", key: "q_rate", code: "rate_limit" }],
    });
    const { result, job, queueRows } = await retryAndReadQueuedWork(t, jobId);
    expect(result.retryableCount).toBe(1);
    expect(job?.status).toBe("extracting");
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0].questionKeys).toEqual(["q_rate"]);
  });

  it("allows retry on status=creditsExhausted", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupExtractionPaperWorkpool(t);
    const { userId } = await seedFlagsAndCredits(t, { paid: 100_000 });
    const { jobId } = await seedJob(t, userId, {
      jobStatus: "creditsExhausted",
      paperStatus: "failed",
      rows: [{ kind: "failed", key: "q_stuck", code: "insufficient_credits" }],
    });
    const { result, job, queueRows } = await retryAndReadQueuedWork(t, jobId);
    expect(result.retryableCount).toBe(1);
    expect(job?.status).toBe("extracting");
    expect(queueRows).toHaveLength(1);
    expect(queueRows[0].questionKeys).toEqual(["q_stuck"]);
  });
});
