import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { setupAggregates } from "./aggregates.test-support";

async function seedPaperContextFixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_paper_context",
      email: "paper-context@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("featureFlags", {
      key: "extraction.pdf",
      enabled: false,
      minimumTier: 0,
      updatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      runEpoch: 0,
      totalPapers: 1,
      name: "Paper Context Test",
      usePdfs: true,
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:paper-context",
      title: "Paper Context",
      status: "extracting" as const,
      processable: true,
      abstract:
        "This abstract is long enough to be used by the extraction context test.",
      isIndexed: true,
      indexingBilled: true,
    });
    const firstQuestionId = await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "What was studied?",
      type: "string" as const,
      order: 0,
      createdAt: now,
    });
    const secondQuestionId = await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q2",
      question: "Was the effect positive?",
      type: "boolean" as const,
      order: 1,
      createdAt: now,
    });
    await ctx.db.insert("extractionResults", {
      jobId,
      paperId,
      questionKey: "q1",
      answer: "Already answered",
      citations: [],
      citationStatus: "grounded" as const,
      status: "completed" as const,
      billed: true,
      attemptCount: 1,
      creditsUsed: 2,
      processedAt: now,
    });
    await ctx.db.insert("extractionEvidenceUnits", {
      jobId,
      paperId,
      evidenceId: "ev1",
      page: 1,
      charRange: [0, 50],
      text: "Evidence sentence",
      tokens: ["evidence", "sentence"],
      anchorConfidence: 0.9,
      source: "pdf",
      createdAt: now,
    });
    return { jobId, paperId, userId, firstQuestionId, secondQuestionId };
  });
}

describe("paper extraction context", () => {
  it("loads the stable per-paper extraction state in one internal query", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const ids = await seedPaperContextFixture(t);

    const context = await t.query(
      internal.extraction.queries.internal.getPaperExtractionContext,
      { jobId: ids.jobId, paperId: ids.paperId },
    );

    expect(context.status).toBe("ok");
    if (context.status !== "ok") throw new Error("unexpected context status");

    expect(context.job._id).toBe(ids.jobId);
    expect(context.job.runEpoch).toBe(0);
    expect(context.paper._id).toBe(ids.paperId);
    expect(context.user?._id).toBe(ids.userId);
    expect(context.pdfEnabled).toBe(false);
    expect(context.questions.map((question) => question.key)).toEqual([
      "q1",
      "q2",
    ]);
    expect(context.questions.map((question) => question._id)).toEqual([
      ids.firstQuestionId,
      ids.secondQuestionId,
    ]);
    expect(context.results.map((result) => result.questionKey)).toEqual([
      "q1",
    ]);
    expect(context.evidenceUnits.map((unit) => unit.evidenceId)).toEqual([
      "ev1",
    ]);
  });

  it("returns not_found when the paper does not belong to the job", async () => {
    const t = convexTest(schema);
    const ids = await seedPaperContextFixture(t);
    const otherPaperId = await t.run(async (ctx) => {
      const now = Date.now();
      const otherJobId = await ctx.db.insert("extractionJobs", {
        userId: ids.userId,
        mode: "extraction" as const,
        sourceType: "history" as const,
        status: "extracting" as const,
        totalPapers: 1,
        name: "Other Job",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("extractionPapers", {
        jobId: otherJobId,
        openalexId: "oa:other",
        title: "Other Paper",
        status: "pending" as const,
      });
    });

    const context = await t.query(
      internal.extraction.queries.internal.getPaperExtractionContext,
      {
        jobId: ids.jobId,
        paperId: otherPaperId as Id<"extractionPapers">,
      },
    );

    expect(context).toEqual({ status: "not_found" });
  });
});
