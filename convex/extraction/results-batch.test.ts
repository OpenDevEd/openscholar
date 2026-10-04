import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedCreditsForTest } from "../billing/billing.test-support";
import { abstractEvidence } from "../../lib/extraction/source-evidence";

async function seedBatchResultFixture(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      libraryItemCount: 0,
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
  it("accepts retained PDF evidence when an older indexing retry left duplicate units", async () => {
    const t = convexTest(schema);
    const { paperId, jobId } = await seedBatchResultFixture(t);
    const unit = { jobId, paperId, evidenceId: "repeated-pdf-unit", page: 1, charRange: [0, 19], text: "The answer is zero.", tokens: [], source: "pdfjs_chunks", anchorConfidence: 1, createdAt: 1 };
    await t.run(async ctx => { await ctx.db.insert("extractionEvidenceUnits", unit); await ctx.db.insert("extractionEvidenceUnits", unit); });
    await t.mutation(internal.extraction.mutations.results.recordQuestionBatch, { paperId, expectedEpoch: 0, completed: [{ questionKey: "q2", creditsUsed: 0, result: {
      answer: 0, confidence: 0, citationStatus: "grounded", citations: [{ evidenceId: unit.evidenceId, page: 1, charRange: unit.charRange, quote: unit.text, retrieval: {}, validated: true }],
    } }], failed: [] });
    const result = await t.run(ctx => ctx.db.query("extractionResults").withIndex("by_paper_question", q => q.eq("paperId", paperId).eq("questionKey", "q2")).unique());
    expect(result).toMatchObject({ answer: 0, confidence: 0, citationStatus: "grounded", citations: [{ source: "pdf", paperId, quote: unit.text }] });
  });

  it.each(["valid", "wrong paper", "stale source", "wrong quote", "wrong range", "null answer"])("checks %s abstract evidence against the saved paper", async (scenario) => {
    const t = convexTest(schema);
    const { paperId } = await seedBatchResultFixture(t);
    const paper = await t.run(ctx => ctx.db.get("extractionPapers", paperId));
    const evidence = await abstractEvidence(paperId, paper!.abstract!);
    const unit = evidence.units[0];
    await t.mutation(internal.extraction.mutations.results.recordQuestionBatch, { paperId, expectedEpoch: 0, completed: [{ questionKey: "q2", creditsUsed: 0, result: {
      answer: scenario === "null answer" ? null : false, confidence: 0, citationStatus: "grounded", citations: [{ source: "abstract", paperId: scenario === "wrong paper" ? "another-paper" : paperId, sourceHash: scenario === "stale source" ? "old" : evidence.sourceHash, evidenceId: unit.evidenceId, quote: scenario === "wrong quote" ? "Unsupported answer" : unit.text, charRange: scenario === "wrong range" ? [0, 1] : unit.charRange, retrieval: {}, validated: true }],
    } }], failed: [] });
    const result = await t.run(ctx => ctx.db.query("extractionResults").withIndex("by_paper_question", q => q.eq("paperId", paperId).eq("questionKey", "q2")).unique());
    expect(result).toMatchObject({ answer: scenario === "null answer" ? null : false, confidence: 0, citationStatus: scenario === "valid" ? "grounded" : scenario === "null answer" ? "insufficient_evidence" : "best_effort" });
    expect(result!.citations).toHaveLength(scenario === "valid" ? 1 : 0);
  });

  it("persists mixed question successes and failures without overwriting already billed rows", async () => {
    const t = convexTest(schema);
    const { paperId } = await seedBatchResultFixture(t);

    const result = await t.mutation(
      internal.extraction.mutations.results.recordQuestionBatch,
      {
        paperId,
        expectedEpoch: 0,
        model: "openai/gpt-6-luna",
        provider: "openrouter",
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
              modelConfidence: 0.94,
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
      confidence: 0.8,
      modelConfidence: 0.94,
      model: "openai/gpt-6-luna",
      provider: "openrouter",
      runEpoch: 0,
      citations: [],
      citationStatus: "best_effort",
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
      model: "openai/gpt-6-luna",
      provider: "openrouter",
      runEpoch: 0,
    });
    expect(byQuestion.get("q3")?.lastError?.code).toBe("schema_validation");
  });

  it("reports a stale epoch without writing question rows", async () => {
    const t = convexTest(schema);
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
