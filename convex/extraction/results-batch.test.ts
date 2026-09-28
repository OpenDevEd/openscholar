import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { setupAggregates } from "./aggregates.test-support";

async function seedBatchResultFixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_results_batch",
      email: "results-batch@test.com",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
    });
    await seedCreditsForTest(ctx, { userId, paid: 100_000, now });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      runEpoch: 0,
      totalPapers: 1,
      name: "Batch Result Test",
      createdAt: now,
      updatedAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:results-batch",
      title: "Results Batch Paper",
      status: "extracting" as const,
      processable: true,
      abstract:
        "This abstract is long enough for the result batch fixture paper.",
      admittedEstimateCredits: 100,
      admittedRunEpoch: 0,
      admittedAt: now,
    });
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "What was studied?",
      type: "string" as const,
      order: 0,
      createdAt: now,
    });
    await ctx.db.insert("extractionQuestions", {
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
      answer: "Existing answer",
      citations: [],
      citationStatus: "grounded" as const,
      status: "completed" as const,
      billed: true,
      attemptCount: 1,
      creditsUsed: 3,
      processedAt: now,
    });
    return { jobId, paperId };
  });
}

describe("recordQuestionBatch", () => {
  it("persists mixed question successes and failures without overwriting already billed rows", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedBatchResultFixture(t);

    const result = await t.mutation(
      internal.extraction.mutations.results.recordQuestionBatch,
      {
        paperId,
        expectedEpoch: 0,
        completed: [
          {
            questionKey: "q1",
            result: {
              answer: "Replacement should be ignored",
              citations: [],
              citationStatus: "grounded",
              pdfContentUsed: false,
            },
            creditsUsed: 7,
          },
          {
            questionKey: "q2",
            result: {
              answer: true,
              confidence: 0.8,
              reasoning: "Mocked batch success",
              citations: [],
              citationStatus: "grounded",
              retrievalDiagnostics: {
                denseCandidates: 0,
                lexicalCandidates: 0,
                fusedCandidates: 0,
                rerankedCandidates: 0,
                validatedCitations: 0,
                strictNull: false,
              },
              pdfContentUsed: false,
            },
            creditsUsed: 5,
          },
        ],
        failed: [
          {
            questionKey: "q3",
            error: {
              code: "schema_validation",
              message: "Mocked batch failure",
              retryable: false,
            },
          },
        ],
      },
    );

    expect(result).toEqual({
      status: "ok",
      completed: ["q2"],
      failed: ["q3"],
      skipped: [{ questionKey: "q1", reason: "already_billed" }],
    });

    const rows = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paperId))
        .collect(),
    );
    const byQuestion = new Map(rows.map((row) => [row.questionKey, row]));

    expect(byQuestion.get("q1")?.answer).toBe("Existing answer");
    expect(byQuestion.get("q1")?.creditsUsed).toBe(3);
    expect(byQuestion.get("q2")).toMatchObject({
      answer: true,
      status: "completed",
      billed: true,
      creditsUsed: 5,
      attemptCount: 1,
    });
    expect(byQuestion.get("q3")).toMatchObject({
      answer: null,
      status: "failed",
      billed: false,
      attemptCount: 1,
    });
    expect(byQuestion.get("q3")?.lastError?.code).toBe("schema_validation");
  });

  it("reports a stale epoch without writing question rows", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedBatchResultFixture(t);

    const result = await t.mutation(
      internal.extraction.mutations.results.recordQuestionBatch,
      {
        paperId,
        expectedEpoch: 99,
        completed: [
          {
            questionKey: "q2",
            result: {
              answer: "Should not persist",
              citations: [],
              citationStatus: "grounded",
              pdfContentUsed: false,
            },
            creditsUsed: 1,
          },
        ],
        failed: [],
      },
    );

    expect(result).toEqual({ status: "skipped", reason: "stale_epoch" });

    const q2Rows = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper_question", (q) =>
          q.eq("paperId", paperId).eq("questionKey", "q2"),
        )
        .collect(),
    );
    expect(q2Rows).toEqual([]);
  });
});
