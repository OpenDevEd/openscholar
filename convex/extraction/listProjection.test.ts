import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { setupAggregates } from "./aggregates.test-support";

const CLERK_OWNER = "clerk_list_projection";

async function seedProjectionFixture(t: ReturnType<typeof convexTest>): Promise<{
  userId: Id<"users">;
  jobId: Id<"extractionJobs">;
  paperId: Id<"extractionPapers">;
}> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: CLERK_OWNER,
      email: "projection@test.com",
      firstName: "List",
      lastName: "Projection",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    for (const key of ["extraction.enabled"] as const) {
      await ctx.db.insert("featureFlags", {
        key,
        enabled: true,
        minimumTier: 0,
        description: `${key} (test)`,
        updatedAt: now,
      });
    }

    await ctx.db.insert("credits", {
      userId,
      freeBalance: 0,
      paidBalance: 10_000,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });

    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      totalPapers: 1,
      processedPapers: 0,
      failedPapers: 0,
      name: "Projection Test",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "Primary outcome?",
      type: "string" as const,
      order: 0,
      createdAt: now,
    });
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q2",
      question: "Secondary outcome?",
      type: "string" as const,
      order: 1,
      createdAt: now,
    });

    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:list-projection",
      title: "The Café Trial",
      abstract: "A study of caffeine outcomes in a randomized setting.",
      authors: ["Jane Doe", "John Roe"],
      processable: true,
      status: "extracting" as const,
      pdfUrl: "https://example.com/paper.pdf",
    });

    return { userId, jobId, paperId };
  });
}

describe("paper list projection write maintenance", () => {
  it("recordOneAnswer updates avgConfidence, questionAnswerTokens, and searchText", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedProjectionFixture(t);

    await t.mutation(internal.extraction.mutations.results.recordOneAnswer, {
      paperId,
      questionKey: "q1",
      result: {
        answer: "Café au lait",
        confidence: 0.75,
        reasoning: "Reasoning",
        citations: [],
        citationStatus: "grounded" as const,
      },
      creditsUsed: 1,
    });

    const paper = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(paper?.avgConfidence).toBe(0.75);
    expect(paper?.questionAnswerTokens).toEqual(["q1::cafe au lait"]);
    expect(paper?.searchText).toContain("the cafe trial");
    expect(paper?.searchText).toContain("cafe au lait");
    expect(paper?.hasPdfSource).toBe(true);
  });

  it("recordOneAnswerFailure flips hasErrors", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedProjectionFixture(t);

    const before = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(before?.hasErrors).toBeUndefined();

    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswerFailure,
      {
        paperId,
        questionKey: "q1",
        error: {
          code: "pdf_invalid",
          message: "Unreadable PDF",
          retryable: false,
        },
      },
    );

    const after = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(after?.hasErrors).toBe(true);
  });

  it("preserves existing answers when a later question completion patches the same paper", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { paperId } = await seedProjectionFixture(t);

    await t.mutation(internal.extraction.mutations.results.recordOneAnswer, {
      paperId,
      questionKey: "q1",
      result: {
        answer: "Original outcome",
        confidence: 0.9,
        reasoning: "Reasoning",
        citations: [],
        citationStatus: "grounded" as const,
      },
      creditsUsed: 1,
    });

    await t.mutation(internal.extraction.mutations.results.recordOneAnswer, {
      paperId,
      questionKey: "q2",
      result: {
        answer: "Secondary outcome",
        confidence: 0.4,
        reasoning: "Reasoning",
        citations: [],
        citationStatus: "best_effort" as const,
      },
      creditsUsed: 1,
    });

    const paper = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(paper?.avgConfidence).toBeCloseTo(0.65);
    expect(paper?.questionAnswerTokens).toEqual([
      "q1::original outcome",
      "q2::secondary outcome",
    ]);
    expect(paper?.searchText).toContain("original outcome");
    expect(paper?.searchText).toContain("secondary outcome");
  });
});
