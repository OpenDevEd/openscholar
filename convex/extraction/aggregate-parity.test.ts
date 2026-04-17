import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

type Ctx = TestConvex<typeof schema>;

/**
 * Safety net SN-5 (P3 plan §6 Parity Contract): the 8 invariants the
 * `@convex-dev/aggregate` migration (Task 11) must preserve. This suite
 * is written against **today's** legacy `extractionJobStats` store; it
 * passes now, keeps passing during the dual-write phase, and keeps
 * passing after the cutover. The only change needed at cutover time is
 * the body of `readCounters` / `readQuestionKeys` below — re-point them
 * at the aggregate and every invariant still holds if parity is real.
 *
 * The 8 invariants (labelled in the tests):
 *   1. Row/key count equals distinct questionKey count per job.
 *   2. Per-question scalars match (12 fields, see Counters type).
 *   3. Confidence bucket boundaries are inclusive-low (>=0.8 high,
 *      [0.5, 0.8) medium, [0, 0.5) low, undefined unknown).
 *   4. Additivity: N papers completed produce N×delta counters.
 *   5. Terminal-state guard: completed/failed/cancelled job counters stay zero.
 *   6. After deleteExtractionInternal, all (jobId, *) counters are zero.
 *   7. Backfill idempotency: two runs produce the same state.
 *   8. OCC-freedom: parallel completions produce the same sum as
 *      sequential completions. (Pre-migration: convex-test serialises
 *      so this holds trivially; the true OCC-freedom surfaces post-cutover
 *      when the aggregate absorbs the concurrent writes.)
 */

type Counters = {
  totalPapers: number;
  totalAnswered: number;
  groundedCount: number;
  bestEffortCount: number;
  insufficientEvidenceCount: number;
  extractionErrorCount: number;
  confidenceSum: number;
  confidenceCount: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  unknownConfidenceCount: number;
};

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

/**
 * Swap the body of this function at the T11.3 cutover to read from the
 * three DirectAggregate instances (count/sum per bucket) instead of the
 * legacy table. Callers must stay unchanged.
 */
async function readCounters(
  t: Ctx,
  jobId: Id<"extractionJobs">,
  questionKey: string
): Promise<Counters> {
  return await t.run(async (ctx) => {
    const row = await ctx.db
      .query("extractionJobStats")
      .withIndex("by_job_question", (q) =>
        q.eq("jobId", jobId).eq("questionKey", questionKey)
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

async function readQuestionKeys(
  t: Ctx,
  jobId: Id<"extractionJobs">
): Promise<string[]> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("extractionJobStats")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .collect();
    return rows.map((r) => r.questionKey);
  });
}

type ResultShape = {
  questionKey: string;
  answer: string | boolean | number | string[] | null;
  confidence?: number;
  citationStatus:
    | "grounded"
    | "best_effort"
    | "insufficient_evidence"
    | "extraction_error";
};

async function seedJob(
  t: Ctx,
  options: {
    paperCount: number;
    questionKeys?: string[];
    jobStatus?: "extracting" | "completed" | "failed" | "cancelled";
    clerkId?: string;
  }
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: options.clerkId ?? "clerk_parity_test",
      email: "parity@test.com",
      firstName: "P",
      lastName: "T",
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
      status: options.jobStatus ?? "extracting",
      totalPapers: options.paperCount,
      processedPapers: 0,
      failedPapers: 0,
      name: "Parity test",
      createdAt: now,
      updatedAt: now,
    });
    if (options.questionKeys) {
      for (let i = 0; i < options.questionKeys.length; i++) {
        await ctx.db.insert("extractionQuestions", {
          jobId,
          key: options.questionKeys[i],
          question: `Q ${options.questionKeys[i]}`,
          type: "string" as const,
          order: i,
          createdAt: now,
        });
      }
    }
    const paperIds: Id<"extractionPapers">[] = [];
    for (let i = 0; i < options.paperCount; i++) {
      const paperId = await ctx.db.insert("extractionPapers", {
        jobId,
        openalexId: `oa:parity${i}`,
        title: `Paper ${i}`,
        status: "extracting" as const,
        processable: true,
      });
      paperIds.push(paperId);
    }
    return { userId, jobId, paperIds };
  });
}

async function complete(
  t: Ctx,
  paperId: Id<"extractionPapers">,
  results: ResultShape[]
) {
  await t.mutation(
    internal.extraction.mutations.results.saveExtractionResultsAndComplete,
    {
      paperId,
      results: results.map((r) => ({
        ...r,
        reasoning: "",
        citations: [],
      })),
      creditsUsed: 0,
      pdfContentUsed: false,
    }
  );
}

describe("SN-5 parity invariants for extractionJobStats ↔ aggregate", () => {
  test("1. row/key count equals distinct questionKey count per job", async () => {
    const t = convexTest(schema);
    const { jobId, paperIds } = await seedJob(t, {
      paperCount: 1,
      questionKeys: ["q1", "q2", "q3"],
    });
    await complete(t, paperIds[0], [
      { questionKey: "q1", answer: "a", confidence: 0.9, citationStatus: "grounded" },
      { questionKey: "q2", answer: "b", confidence: 0.6, citationStatus: "best_effort" },
      { questionKey: "q3", answer: null, citationStatus: "insufficient_evidence" },
    ]);
    const keys = await readQuestionKeys(t, jobId);
    expect(keys.sort()).toEqual(["q1", "q2", "q3"]);
  });

  test("2. per-question scalars (12 fields) match bit-for-bit", async () => {
    const t = convexTest(schema);
    const { jobId, paperIds } = await seedJob(t, { paperCount: 1 });
    await complete(t, paperIds[0], [
      { questionKey: "k", answer: "x", confidence: 0.9, citationStatus: "grounded" },
    ]);
    expect(await readCounters(t, jobId, "k")).toEqual({
      totalPapers: 1,
      totalAnswered: 1,
      groundedCount: 1,
      bestEffortCount: 0,
      insufficientEvidenceCount: 0,
      extractionErrorCount: 0,
      confidenceSum: 0.9,
      confidenceCount: 1,
      highConfidenceCount: 1,
      mediumConfidenceCount: 0,
      lowConfidenceCount: 0,
      unknownConfidenceCount: 0,
    });
  });

  test("3. confidence bucket boundaries are inclusive-low", async () => {
    const t = convexTest(schema);
    const { jobId, paperIds } = await seedJob(t, { paperCount: 5 });
    const cases: Array<[number | undefined, "high" | "medium" | "low" | "unknown"]> = [
      [0.8, "high"],
      [0.79, "medium"],
      [0.5, "medium"],
      [0.49, "low"],
      [undefined, "unknown"],
    ];
    for (let i = 0; i < cases.length; i++) {
      const [conf] = cases[i];
      await complete(t, paperIds[i], [
        {
          questionKey: "k",
          answer: "x",
          confidence: conf,
          citationStatus: "grounded",
        },
      ]);
    }
    const c = await readCounters(t, jobId, "k");
    expect(c.highConfidenceCount).toBe(1);   // 0.8
    expect(c.mediumConfidenceCount).toBe(2); // 0.79 + 0.5
    expect(c.lowConfidenceCount).toBe(1);    // 0.49
    expect(c.unknownConfidenceCount).toBe(1); // undefined
  });

  test("4. N paper completions produce N×delta counters (additivity)", async () => {
    const t = convexTest(schema);
    const N = 7;
    const { jobId, paperIds } = await seedJob(t, { paperCount: N });
    for (const paperId of paperIds) {
      await complete(t, paperId, [
        { questionKey: "k", answer: "x", confidence: 0.9, citationStatus: "grounded" },
      ]);
    }
    const c = await readCounters(t, jobId, "k");
    expect(c.totalPapers).toBe(N);
    expect(c.totalAnswered).toBe(N);
    expect(c.groundedCount).toBe(N);
    expect(c.highConfidenceCount).toBe(N);
    expect(c.confidenceCount).toBe(N);
    expect(c.confidenceSum).toBeCloseTo(0.9 * N);
  });

  test("5. terminal-state guard: cancelled/completed/failed jobs never bump", async () => {
    for (const jobStatus of ["completed", "failed", "cancelled"] as const) {
      const t = convexTest(schema);
      const { jobId, paperIds } = await seedJob(t, {
        paperCount: 1,
        jobStatus,
      });
      await complete(t, paperIds[0], [
        { questionKey: "k", answer: "x", confidence: 0.9, citationStatus: "grounded" },
      ]);
      expect(await readCounters(t, jobId, "k")).toEqual(ZERO);
    }
  });

  test("6. after deleteExtractionInternal, all (jobId, *) counters are zero", async () => {
    const t = convexTest(schema);
    const { jobId, paperIds } = await seedJob(t, { paperCount: 1 });
    await complete(t, paperIds[0], [
      { questionKey: "k", answer: "x", confidence: 0.9, citationStatus: "grounded" },
    ]);
    expect((await readCounters(t, jobId, "k")).totalPapers).toBe(1);
    vi.useFakeTimers();
    await t.mutation(internal.extraction.mutations.internal.admin.deleteExtractionInternal, {
      jobId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers.bind(vi));
    vi.useRealTimers();
    expect(await readCounters(t, jobId, "k")).toEqual(ZERO);
    expect(await readQuestionKeys(t, jobId)).toEqual([]);
  });

  test("7. backfill idempotency: two runs produce the same state", async () => {
    const t = convexTest(schema);
    const { jobId, paperIds } = await seedJob(t, {
      paperCount: 2,
      questionKeys: ["k"],
    });
    // Seed extractionResults directly so backfillJobStats has something to scan.
    await t.run(async (ctx) => {
      const now = Date.now();
      for (const paperId of paperIds) {
        await ctx.db.insert("extractionResults", {
          jobId,
          paperId,
          questionKey: "k",
          answer: "x",
          confidence: 0.9,
          citations: [],
          citationStatus: "grounded" as const,
          processedAt: now,
        });
      }
    });
    // No existing stats row → first run rebuilds.
    await t.mutation(internal.extraction.mutations.internal.admin.backfillJobStats, { jobId });
    const afterFirst = await readCounters(t, jobId, "k");
    // Second run short-circuits (stats row exists); state must stay identical.
    await t.mutation(internal.extraction.mutations.internal.admin.backfillJobStats, { jobId });
    const afterSecond = await readCounters(t, jobId, "k");
    expect(afterSecond).toEqual(afterFirst);
    expect(afterFirst.totalPapers).toBe(2);
    expect(afterFirst.groundedCount).toBe(2);
  });

  test("8. parallel completions produce the same sum as sequential", async () => {
    // Sequential baseline
    const tSeq = convexTest(schema);
    const seqSeed = await seedJob(tSeq, { paperCount: 20 });
    for (const paperId of seqSeed.paperIds) {
      await complete(tSeq, paperId, [
        { questionKey: "k", answer: "x", confidence: 0.9, citationStatus: "grounded" },
      ]);
    }
    const seq = await readCounters(tSeq, seqSeed.jobId, "k");

    // Parallel — same total workload, kicked off concurrently. Convex-test
    // serialises mutations, so today this invariant holds trivially; the
    // real OCC-freedom proof lands post-migration when the aggregate
    // component absorbs concurrent writes without conflict.
    const tPar = convexTest(schema);
    const parSeed = await seedJob(tPar, { paperCount: 20 });
    await Promise.all(
      parSeed.paperIds.map((paperId) =>
        complete(tPar, paperId, [
          { questionKey: "k", answer: "x", confidence: 0.9, citationStatus: "grounded" },
        ])
      )
    );
    const par = await readCounters(tPar, parSeed.jobId, "k");

    expect(par).toEqual(seq);
    expect(par.totalPapers).toBe(20);
    expect(par.confidenceSum).toBeCloseTo(0.9 * 20);
  });
});
