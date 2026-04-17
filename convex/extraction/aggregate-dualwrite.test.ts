import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { readAggregateCounters, type Counters } from "./aggregates";
import { setupAggregates } from "./aggregates.test-support";

/**
 * T11.2 dual-write contract. Once saveExtractionResultsAndComplete writes
 * into BOTH the legacy extractionJobStats row AND the aggregate
 * components, the two stores must return identical counters for every
 * (jobId, questionKey) until T11.4 narrows away the legacy store.
 *
 * Each test here completes papers via the real mutation, then asserts
 * the aggregate reader matches the legacy reader bit-for-bit. The SN-5
 * parity suite already asserts the legacy-only invariants; this suite
 * adds the aggregate-side assertions.
 */

type Ctx = TestConvex<typeof schema>;

const ZERO: Counters = {
  totalPapers: 0,
  totalAnswered: 0,
  groundedCount: 0,
  bestEffortCount: 0,
  insufficientEvidenceCount: 0,
  extractionErrorCount: 0,
  confidenceSum: 0,
  confidenceCount: 0,
  highConfidenceCount: 0,
  mediumConfidenceCount: 0,
  lowConfidenceCount: 0,
  unknownConfidenceCount: 0,
};

async function readLegacyCounters(
  t: Ctx,
  jobId: Id<"extractionJobs">,
  questionKey: string,
): Promise<Counters> {
  return await t.run(async (ctx) => {
    const row = await ctx.db
      .query("extractionJobStats")
      .withIndex("by_job_question", (q) =>
        q.eq("jobId", jobId).eq("questionKey", questionKey),
      )
      .unique();
    if (!row) return { ...ZERO };
    return {
      totalPapers: row.totalPapers,
      totalAnswered: row.totalAnswered,
      groundedCount: row.groundedCount,
      bestEffortCount: row.bestEffortCount,
      insufficientEvidenceCount: row.insufficientEvidenceCount,
      extractionErrorCount: row.extractionErrorCount,
      confidenceSum: row.confidenceSum,
      confidenceCount: row.confidenceCount,
      highConfidenceCount: row.highConfidenceCount,
      mediumConfidenceCount: row.mediumConfidenceCount,
      lowConfidenceCount: row.lowConfidenceCount,
      unknownConfidenceCount: row.unknownConfidenceCount,
    };
  });
}

async function readAggCounters(
  t: Ctx,
  jobId: Id<"extractionJobs">,
  questionKey: string,
): Promise<Counters> {
  return await t.run(async (ctx) =>
    readAggregateCounters(ctx, jobId, questionKey),
  );
}

async function seedJob(
  t: Ctx,
  paperCount: number,
  jobStatus: "extracting" | "completed" | "failed" | "cancelled" = "extracting",
  questionKeys: string[] = ["k"],
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: `clerk_dual_${Math.random()}`,
      email: "dual@test.com",
      firstName: "D",
      lastName: "W",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    await ctx.db.insert("credits", {
      userId,
      freeBalance: 0,
      paidBalance: 100000,
      lifetimeUsed: 0,
      lastUpdatedAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      sourceType: "history" as const,
      status: jobStatus,
      totalPapers: paperCount,
      processedPapers: 0,
      failedPapers: 0,
      name: "Dual test",
      createdAt: now,
      updatedAt: now,
    });
    // extractionQuestions must exist for the cascade delete to know which
    // (jobId, questionKey) aggregate namespaces to clear. Production always
    // inserts questions before any result; mirror that here.
    for (let i = 0; i < questionKeys.length; i++) {
      await ctx.db.insert("extractionQuestions", {
        jobId,
        key: questionKeys[i],
        question: `Q ${questionKeys[i]}`,
        type: "string" as const,
        order: i,
        createdAt: now,
      });
    }
    const paperIds: Id<"extractionPapers">[] = [];
    for (let i = 0; i < paperCount; i++) {
      paperIds.push(
        await ctx.db.insert("extractionPapers", {
          jobId,
          openalexId: `oa:dual${i}`,
          title: `P${i}`,
          status: "extracting" as const,
          processable: true,
        }),
      );
    }
    return { jobId, paperIds };
  });
}

type CitationStatus =
  | "grounded"
  | "best_effort"
  | "insufficient_evidence"
  | "extraction_error";

async function complete(
  t: Ctx,
  paperId: Id<"extractionPapers">,
  rs: Array<{
    questionKey: string;
    answer: string | boolean | number | string[] | null;
    confidence?: number;
    citationStatus: CitationStatus;
  }>,
) {
  await t.mutation(
    internal.extraction.mutations.results.saveExtractionResultsAndComplete,
    {
      paperId,
      results: rs.map((r) => ({ ...r, reasoning: "", citations: [] })),
      creditsUsed: 0,
      pdfContentUsed: false,
    },
  );
}

describe("T11.2 dual-write parity — saveExtractionResultsAndComplete", () => {
  test("one grounded result with confidence 0.9 — legacy and aggregate both match", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedJob(t, 1);
    await complete(t, paperIds[0], [
      { questionKey: "k", answer: "x", confidence: 0.9, citationStatus: "grounded" },
    ]);
    const legacy = await readLegacyCounters(t, jobId, "k");
    const agg = await readAggCounters(t, jobId, "k");
    expect(agg).toEqual(legacy);
    expect(agg.totalPapers).toBe(1);
    expect(agg.groundedCount).toBe(1);
    expect(agg.highConfidenceCount).toBe(1);
    expect(agg.confidenceSum).toBeCloseTo(0.9);
  });

  test("confidence bucket boundaries match between stores across 5 papers", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedJob(t, 5);
    const confidences: Array<number | undefined> = [0.8, 0.79, 0.5, 0.49, undefined];
    for (let i = 0; i < confidences.length; i++) {
      await complete(t, paperIds[i], [
        {
          questionKey: "k",
          answer: "x",
          confidence: confidences[i],
          citationStatus: "grounded",
        },
      ]);
    }
    const legacy = await readLegacyCounters(t, jobId, "k");
    const agg = await readAggCounters(t, jobId, "k");
    expect(agg).toEqual(legacy);
    expect(agg.highConfidenceCount).toBe(1);
    expect(agg.mediumConfidenceCount).toBe(2);
    expect(agg.lowConfidenceCount).toBe(1);
    expect(agg.unknownConfidenceCount).toBe(1);
  });

  test("N paper completions stay in lockstep (additivity)", async () => {
    const N = 7;
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedJob(t, N);
    for (const paperId of paperIds) {
      await complete(t, paperId, [
        { questionKey: "k", answer: "x", confidence: 0.9, citationStatus: "grounded" },
      ]);
    }
    const legacy = await readLegacyCounters(t, jobId, "k");
    const agg = await readAggCounters(t, jobId, "k");
    expect(agg).toEqual(legacy);
    expect(agg.totalPapers).toBe(N);
  });

  test("terminal-state jobs bump neither store", async () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      const t = convexTest(schema);
      setupAggregates(t);
      const { jobId, paperIds } = await seedJob(t, 1, status);
      await complete(t, paperIds[0], [
        { questionKey: "k", answer: "x", confidence: 0.9, citationStatus: "grounded" },
      ]);
      const legacy = await readLegacyCounters(t, jobId, "k");
      const agg = await readAggCounters(t, jobId, "k");
      expect(legacy).toEqual(ZERO);
      expect(agg).toEqual(ZERO);
    }
  });

  test("null answer counts as unanswered in both stores", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedJob(t, 1);
    await complete(t, paperIds[0], [
      {
        questionKey: "k",
        answer: null,
        citationStatus: "insufficient_evidence",
      },
    ]);
    const legacy = await readLegacyCounters(t, jobId, "k");
    const agg = await readAggCounters(t, jobId, "k");
    expect(agg).toEqual(legacy);
    expect(agg.totalPapers).toBe(1);
    expect(agg.totalAnswered).toBe(0);
    expect(agg.insufficientEvidenceCount).toBe(1);
  });

  test("citation-status mix across all 4 statuses matches", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedJob(t, 4);
    const statuses: CitationStatus[] = [
      "grounded",
      "best_effort",
      "insufficient_evidence",
      "extraction_error",
    ];
    for (let i = 0; i < 4; i++) {
      await complete(t, paperIds[i], [
        {
          questionKey: "k",
          answer: "x",
          confidence: 0.9,
          citationStatus: statuses[i],
        },
      ]);
    }
    const legacy = await readLegacyCounters(t, jobId, "k");
    const agg = await readAggCounters(t, jobId, "k");
    expect(agg).toEqual(legacy);
    expect(agg.groundedCount).toBe(1);
    expect(agg.bestEffortCount).toBe(1);
    expect(agg.insufficientEvidenceCount).toBe(1);
    expect(agg.extractionErrorCount).toBe(1);
  });

  test("deleteExtractionInternal cascade zeroes the aggregate as well", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedJob(t, 2);
    await complete(t, paperIds[0], [
      { questionKey: "k", answer: "x", confidence: 0.9, citationStatus: "grounded" },
    ]);
    await complete(t, paperIds[1], [
      { questionKey: "k", answer: "y", confidence: 0.4, citationStatus: "best_effort" },
    ]);
    expect((await readAggCounters(t, jobId, "k")).totalPapers).toBe(2);

    vi.useFakeTimers();
    await t.mutation(
      internal.extraction.mutations.internal.admin.deleteExtractionInternal,
      { jobId },
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();

    const legacy = await readLegacyCounters(t, jobId, "k");
    const agg = await readAggCounters(t, jobId, "k");
    expect(legacy).toEqual(ZERO);
    expect(agg).toEqual(ZERO);
  });
});
