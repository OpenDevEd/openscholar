import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { setupAggregates } from "./aggregates.test-support";
import {
  setupTransactionAggregates,
  seedCreditsForTest,
} from "../credits/aggregates.test-support";
import { readBalance } from "../credits/balanceCounter";

async function seed(
  t: ReturnType<typeof convexTest>,
  startingCredits = 1000,
  questionKeys: readonly string[] = ["q1"],
) {
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
    const creditsId = await seedCreditsForTest(ctx, {
      userId,
      free: 0,
      paid: startingCredits,
      now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      totalPapers: 1,
      name: "Billing Idempotency Test",
      createdAt: now,
      updatedAt: now,
    });
    // finalizePaper rolls up over every seeded question for the job, so
    // every test must seed every questionKey it will recordOneAnswer
    // against, otherwise the rollup stays "pending" and the debit path
    // is never reached.
    for (const [order, key] of questionKeys.entries()) {
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key,
        question: `${key}?`,
        type: "string" as const,
        order,
        createdAt: now,
      });
    }
    const paperId = await ctx.db.insert("extractionPapers", {
      jobId,
      openalexId: "oa:idem",
      title: "Paper",
      status: "extracting" as const,
    });
    return { userId, creditsId, jobId, paperId };
  });
}

async function readPaidBalance(
  t: ReturnType<typeof convexTest>,
  creditsId: Awaited<ReturnType<typeof seed>>["creditsId"],
) {
  return (await t.run((ctx) => readBalance(ctx, creditsId))).paid;
}

describe("embedding credit idempotency (markPaperIndexed)", () => {
  it("deducts once on first billing call, skips on retry", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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

    expect(await readPaidBalance(t, creditsId)).toBe(997);
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

    expect(await readPaidBalance(t, creditsId)).toBe(997);
  });

  it("does not deduct when billing is omitted (cancellation path)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);
    const { creditsId, paperId } = await seed(t, 1000);

    await t.mutation(internal.extraction.mutations.papers.markPaperIndexed, {
      paperId,
      ragEntryId: "rag:cancel",
    });

    expect(await readPaidBalance(t, creditsId)).toBe(1000);
    const after = await t.run((ctx) => ctx.db.get("extractionPapers", paperId));
    expect(after?.isIndexed).toBe(true);
    // Not billed on the cancellation path — a later retry with billing still
    // charges once (gated on indexingBilled, which is still undefined).
    expect(after?.indexingBilled).toBeUndefined();
  });

  it("does not deduct when creditsToDeduct is 0", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);
    const { userId, creditsId, jobId, paperId } = await seed(t, 1000);

    await t.mutation(internal.extraction.mutations.papers.markPaperIndexed, {
      paperId,
      ragEntryId: "rag:zero",
      billing: { userId, jobId, creditsToDeduct: 0, embeddingTokens: 0 },
    });

    expect(await readPaidBalance(t, creditsId)).toBe(1000);
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

  it("recordOneAnswer alone does NOT debit; debit is deferred to finalizePaper", async () => {
    // Tier C: per-question creditsUsed lives on the extractionResults row
    // (not the paper row — that was the OCC contention point). The wallet
    // is touched once at terminal transition in finalizePaper, which sums
    // result.creditsUsed across the paper's question rows.
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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

    expect(await readPaidBalance(t, creditsId)).toBe(1000);
    const paperAfterAnswer = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paperAfterAnswer?.creditsUsed).toBeUndefined();
    expect(paperAfterAnswer?.questionsBilled).toBeUndefined();
    const resultRow = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper_question", (q) =>
          q.eq("paperId", paperId).eq("questionKey", "q1"),
        )
        .unique(),
    );
    expect(resultRow?.creditsUsed).toBe(5);
    expect(resultRow?.billed).toBe(true);
    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(0);
  });

  it("finalizePaper drains paper.creditsUsed exactly once and sets questionsBilled", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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

    expect(await readPaidBalance(t, creditsId)).toBe(995);
    const firstPaper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(firstPaper?.status).toBe("completed");
    expect(firstPaper?.questionsBilled).toBe(true);
    const firstResult = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paperId))
        .unique(),
    );
    expect(firstResult?.billed).toBe(true);
    const firstJob = await t.run((ctx) => ctx.db.get("extractionJobs", jobId));
    expect(firstJob?.status).toBe("completed");

    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(1);
    expect(charges[0]?.billingType).toBe("extraction_llm");
    expect(charges[0]?.amount).toBe(-5);
  });

  it("finalizePaper aggregates multi-question paper.creditsUsed into a single debit", async () => {
    // The whole point of the refactor: 3 questions × 5 credits issues
    // ONE creditTransactions row, not three. This is what eliminates
    // P×Q parallel writes to the credits row.
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);
    const { creditsId, jobId, paperId } = await seed(t, 1000, [
      "q1",
      "q2",
      "q3",
    ]);

    for (const key of ["q1", "q2", "q3"] as const) {
      await t.mutation(
        internal.extraction.mutations.results.recordOneAnswer,
        {
          paperId,
          questionKey: key,
          result: sampleResult,
          creditsUsed: 5,
        },
      );
      expect(await readPaidBalance(t, creditsId)).toBe(1000);
    }

    await t.mutation(
      internal.extraction.mutations.results.finalizePaper,
      { paperId },
    );

    expect(await readPaidBalance(t, creditsId)).toBe(985);
    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(1);
    expect(charges[0]?.amount).toBe(-15);
  });

  it("result.billed gate blocks re-bill when job+paper are reset to active (questionsBilled also holds)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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
    expect(await readPaidBalance(t, creditsId)).toBe(995);

    // Adversarial: a buggy admin tool resets job/paper status. The
    // extractionResults row still has billed=true → recordOneAnswer
    // short-circuits before re-incrementing paper.creditsUsed.
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

    expect(await readPaidBalance(t, creditsId)).toBe(995);
  });

  it("questionsBilled blocks re-debit even when result.billed AND paper status are reset", async () => {
    // Defense-in-depth: the adversarial reset that clears every upstream
    // gate (result.billed=false, job/paper rolled back to "extracting")
    // must still be blocked at the paper-level questionsBilled flag
    // inside finalizePaper. Tier C: result.creditsUsed (the per-question
    // accumulator) re-grows on the replayed recordOneAnswer; the
    // questionsBilled gate is what keeps the wallet untouched.
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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
    expect(await readPaidBalance(t, creditsId)).toBe(995);

    // Clear EVERY upstream gate except questionsBilled.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("extractionResults")
        .withIndex("by_paper", (q) => q.eq("paperId", paperId))
        .unique();
      if (row) await ctx.db.patch(row._id, { billed: false });
      await ctx.db.patch("extractionJobs", jobId, { status: "extracting" });
      await ctx.db.patch("extractionPapers", paperId, {
        status: "extracting",
      });
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

    // The per-question result row has re-accumulated to 10 (5 from the
    // first attempt + 5 from the adversarial replay). paper.questionsBilled
    // is still true from the first finalize, which is the only thing
    // keeping the wallet from being touched again.
    const resultBeforeFinalize = await t.run((ctx) =>
      ctx.db
        .query("extractionResults")
        .withIndex("by_paper_question", (q) =>
          q.eq("paperId", paperId).eq("questionKey", "q1"),
        )
        .unique(),
    );
    expect(resultBeforeFinalize?.creditsUsed).toBe(10);
    const paperBeforeFinalize = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paperBeforeFinalize?.questionsBilled).toBe(true);

    await t.mutation(
      internal.extraction.mutations.results.finalizePaper,
      { paperId },
    );

    expect(await readPaidBalance(t, creditsId)).toBe(995);
    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(1);
  });

  it("finalizePaper with paper.creditsUsed=0 doesn't write a charge or set questionsBilled", async () => {
    // The zero-credit path must not insert an empty creditTransactions
    // row (deductCreditsTransaction throws INVALID_AMOUNT on amount=0,
    // so the guard is required). questionsBilled stays unset so a
    // later resume that retries with a real cost can still bill.
    const t = convexTest(schema);
    setupTransactionAggregates(t);
    setupAggregates(t);
    const { creditsId, jobId, paperId } = await seed(t, 1000);

    await t.mutation(
      internal.extraction.mutations.results.recordOneAnswer,
      {
        paperId,
        questionKey: "q1",
        result: sampleResult,
        creditsUsed: 0,
      },
    );
    await t.mutation(
      internal.extraction.mutations.results.finalizePaper,
      { paperId },
    );

    expect(await readPaidBalance(t, creditsId)).toBe(1000);
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

  it("finalizePaper called twice debits once (terminal-status guard already short-circuits)", async () => {
    // Belt-and-suspenders: the most likely retry path is two
    // finalizePaper calls without any reset. The isTerminalPaperStatus
    // guard at the top of the mutation makes the second call a no-op
    // before it even reaches the debit logic.
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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
    await t.mutation(
      internal.extraction.mutations.results.finalizePaper,
      { paperId },
    );

    expect(await readPaidBalance(t, creditsId)).toBe(995);
    const charges = await t.run((ctx) =>
      ctx.db
        .query("creditTransactions")
        .withIndex("by_job", (q) => q.eq("jobId", jobId))
        .collect(),
    );
    expect(charges).toHaveLength(1);
  });

  it("skips deduct when paper.creditsUsed never accumulated (recordOneAnswer with creditsUsed=0)", async () => {
    const t = convexTest(schema);
    setupTransactionAggregates(t);
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

    expect(await readPaidBalance(t, creditsId)).toBe(1000);
    const paper = await t.run((ctx) =>
      ctx.db.get("extractionPapers", paperId),
    );
    expect(paper?.creditsUsed).toBeUndefined();
  });
});
