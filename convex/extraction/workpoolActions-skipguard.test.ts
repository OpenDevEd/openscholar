/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

/**
 * Plan-06 extractOneQuestion skip-guard.
 *
 * The gate inside the workflow handler stops NEW question dispatches
 * while the job is paused. But questions that were already enqueued in
 * the workpool when the user clicked Pause will still start. This
 * action-entry guard ensures those in-flight dispatches short-circuit
 * before any LLM call / credit charge, returning {skipped, "paused"}.
 *
 * We exercise only the guard surface — seeded rows let the action
 * execute past its three lookups (paper, job+flags, existing-result)
 * and then hit the skip branch. The action never reaches RAG or LLM
 * code paths so component registration is unnecessary.
 */

const CLERK = "clerk_skipguard_owner";

async function seedJobAndQuestion(
  t: ReturnType<typeof convexTest>,
  jobStatus:
    | "extracting"
    | "paused"
    | "creditsExhausted"
    | "cancelled"
    | "completed",
): Promise<{
  jobId: Id<"extractionJobs">;
  paperId: Id<"extractionPapers">;
  questionId: Id<"extractionQuestions">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK,
      email: "skip@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      name: "Skip Test Job",
      sourceType: "history" as const,
      status: jobStatus,
      totalPapers: 1,
      processedPapers: 0,
      failedPapers: 0,
      usePdfs: false,
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:skip_1",
      title: "Skip Paper",
      status: "extracting" as const,
      indexingBilled: true,
      ragEntryId: "rag:skip_1",
      isIndexed: true,
    });
    const questionId = await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "What is the goal?",
      type: "string" as const,
      order: 0,
      createdAt: now,
    });
    return { jobId, paperId, questionId };
  });
}

describe("extractOneQuestion skip-guard", () => {
  it("short-circuits on paused jobs with status:skipped, reason:paused", async () => {
    const t = convexTest(schema);
    const { jobId, paperId, questionId } = await seedJobAndQuestion(
      t,
      "paused",
    );

    const result = await t.action(
      internal.extraction.workpoolActions.extractOneQuestion,
      { jobId, paperId, questionId },
    );
    expect(result).toEqual({ status: "skipped", reason: "paused" });

    // No extractionResults row persisted — the guard skips before any
    // write site.
    const rows = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paperId))
        .collect(),
    );
    expect(rows).toEqual([]);
  });

  it("short-circuits on creditsExhausted (plan 03 path still honored)", async () => {
    const t = convexTest(schema);
    const { jobId, paperId, questionId } = await seedJobAndQuestion(
      t,
      "creditsExhausted",
    );
    const result = await t.action(
      internal.extraction.workpoolActions.extractOneQuestion,
      { jobId, paperId, questionId },
    );
    expect(result).toEqual({
      status: "skipped",
      reason: "credits_exhausted",
    });
  });

  it("short-circuits on cancelled jobs", async () => {
    const t = convexTest(schema);
    const { jobId, paperId, questionId } = await seedJobAndQuestion(
      t,
      "cancelled",
    );
    const result = await t.action(
      internal.extraction.workpoolActions.extractOneQuestion,
      { jobId, paperId, questionId },
    );
    expect(result).toEqual({ status: "skipped", reason: "cancelled" });
  });

  it("short-circuits on terminal (completed) jobs", async () => {
    const t = convexTest(schema);
    const { jobId, paperId, questionId } = await seedJobAndQuestion(
      t,
      "completed",
    );
    const result = await t.action(
      internal.extraction.workpoolActions.extractOneQuestion,
      { jobId, paperId, questionId },
    );
    expect(result).toEqual({ status: "skipped", reason: "job_terminal" });
  });

  it("short-circuits on a billed result (idempotency gate precedes status checks)", async () => {
    const t = convexTest(schema);
    const { jobId, paperId, questionId } = await seedJobAndQuestion(
      t,
      "extracting", // NOT paused — billed guard fires first
    );
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("extractionResults", {
        jobId,
        paperId,
        questionKey: "q1",
        answer: "ok",
        citations: [],
        citationStatus: "grounded" as const,
        status: "completed" as const,
        billed: true,
        attemptCount: 1,
        processedAt: now,
      });
    });
    const result = await t.action(
      internal.extraction.workpoolActions.extractOneQuestion,
      { jobId, paperId, questionId },
    );
    expect(result).toEqual({ status: "skipped", reason: "already_billed" });
  });
});
