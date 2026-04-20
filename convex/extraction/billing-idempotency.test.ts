import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { setupAggregates } from "./aggregates.test-support";

async function seed(t: ReturnType<typeof convexTest>, startingCredits = 1000) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_billing_idem",
      email: "billing@test.com",
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
      paidBalance: startingCredits,
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
      name: "Billing Idempotency Test",
      createdAt: now,
      updatedAt: now,
    });
    // Plan-02 finalizePaper counts pending questions, so every test needs
    // at least one seeded extractionQuestion row per questionKey it uses.
    await ctx.db.insert("extractionQuestions", {
      jobId,
      key: "q1",
      question: "Q1?",
      type: "string" as const,
      order: 0,
      createdAt: now,
    });
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:idem",
      title: "Paper",
      status: "extracting" as const,
    });
    return { userId, creditsId, jobId, paperId };
  });
}

async function readBalance(
  t: ReturnType<typeof convexTest>,
  creditsId: Awaited<ReturnType<typeof seed>>["creditsId"],
) {
  const row = await t.run((ctx) => ctx.db.get("credits", creditsId));
  return row!.paidBalance;
}

describe("embedding credit idempotency (markPaperIndexed)", () => {
  it("deducts once on first billing call, skips on retry", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { userId, creditsId, jobId, paperId } = await seed(t, 1000);

    await t.mutation(internal.extraction.mutations.papers.markPaperIndexed, {
      paperId,
      ragEntryId: "rag:1",
      billing: {
        userId,
        jobId,
        creditsToDeduct: 3,
        embeddingTokens: 1234,
      },
    });

    expect(await readBalance(t, creditsId)).toBe(997);
    const afterFirst = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(afterFirst?.isIndexed).toBe(true);
    expect(afterFirst?.indexingBilled).toBe(true);

    // Retry the same mutation — simulates a workpool retry after a crash
    // between rag.add() and the mutation commit. Without the gate this would
    // double-charge.
    await t.mutation(internal.extraction.mutations.papers.markPaperIndexed, {
      paperId,
      ragEntryId: "rag:1",
      billing: {
        userId,
        jobId,
        creditsToDeduct: 3,
        embeddingTokens: 1234,
      },
    });

    expect(await readBalance(t, creditsId)).toBe(997);
  });

  it("does not deduct when billing is omitted (cancellation path)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { creditsId, paperId } = await seed(t, 1000);

    await t.mutation(internal.extraction.mutations.papers.markPaperIndexed, {
      paperId,
      ragEntryId: "rag:cancel",
    });

    expect(await readBalance(t, creditsId)).toBe(1000);
    const after = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(after?.isIndexed).toBe(true);
    // Not billed on the cancellation path — a later retry with billing still
    // charges once (gated on indexingBilled, which is still undefined).
    expect(after?.indexingBilled).toBeUndefined();
  });

  it("does not deduct when creditsToDeduct is 0", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { userId, creditsId, jobId, paperId } = await seed(t, 1000);

    await t.mutation(internal.extraction.mutations.papers.markPaperIndexed, {
      paperId,
      ragEntryId: "rag:zero",
      billing: { userId, jobId, creditsToDeduct: 0, embeddingTokens: 0 },
    });

    expect(await readBalance(t, creditsId)).toBe(1000);
  });
});

describe("LLM extraction credit idempotency (recordOneAnswer + finalizePaper)", () => {
  const sampleResult = {
    answer: "A",
    confidence: 0.9,
    reasoning: "r",
    citations: [],
    citationStatus: "grounded" as const,
  };

  it("deducts once, skips on direct retry because the result.billed gate short-circuits", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { creditsId, jobId, paperId } = await seed(t, 1000);

    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswer,
      {
        paperId,
        questionKey: "q1",
        result: sampleResult,
        creditsUsed: 5,
      },
    );
    await t.mutation(
      internal.extraction.mutations.results.finalizePaper,
      { paperId },
    );

    expect(await readBalance(t, creditsId)).toBe(995);
    const firstPaper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(firstPaper?.status).toBe("completed");
    const firstResult = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paperId))
        .unique(),
    );
    expect(firstResult?.billed).toBe(true);
    const firstJob = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(firstJob?.status).toBe("completed");

    // Retry: the result row already has billed=true, so the per-question
    // idempotency gate short-circuits before the LLM re-run / credit debit.
    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswer,
      {
        paperId,
        questionKey: "q1",
        result: sampleResult,
        creditsUsed: 5,
      },
    );

    expect(await readBalance(t, creditsId)).toBe(995);
    const results = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paperId))
        .collect(),
    );
    expect(results).toHaveLength(1);
  });

  it("result.billed gate blocks re-bill even if job+paper are reset to active", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { creditsId, jobId, paperId } = await seed(t, 1000);

    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswer,
      {
        paperId,
        questionKey: "q1",
        result: sampleResult,
        creditsUsed: 5,
      },
    );
    await t.mutation(
      internal.extraction.mutations.results.finalizePaper,
      { paperId },
    );
    expect(await readBalance(t, creditsId)).toBe(995);

    // Adversarial case: something resets the job back to "extracting"
    // and the paper back to "extracting" (e.g. buggy admin tool). The
    // extractionResults row still has billed=true — the per-question
    // gate must still fire.
    await t.run(async (ctx) => {
      await ctx.db.patch("extractionJobs", jobId, { status: "extracting" });
      await ctx.db.patch("extractionPapers", paperId, { status: "extracting" });
    });

    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswer,
      {
        paperId,
        questionKey: "q1",
        result: sampleResult,
        creditsUsed: 5,
      },
    );

    expect(await readBalance(t, creditsId)).toBe(995);
  });

  it("skips deduct when creditsUsed is 0", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { creditsId, paperId } = await seed(t, 1000);

    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswer,
      {
        paperId,
        questionKey: "q1",
        result: sampleResult,
        creditsUsed: 0,
      },
    );

    expect(await readBalance(t, creditsId)).toBe(1000);
  });
});
