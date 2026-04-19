import { convexTest, type TestConvex } from "convex-test";
import { describe, test, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import {
  recordResult,
  forgetResult,
  clearJobAggregates,
  readAggregateCounters,
  readAggregateSummariesByQuestion,
} from "./aggregates";
import { setupAggregates } from "./aggregates.test-support";

/**
 * Task 11 — direct tests for the @convex-dev/aggregate helpers. The SN-5
 * parity suite (aggregate-parity.test.ts) verifies live-write parity with
 * the legacy store; this file pins the aggregate helpers' behavior in
 * isolation, so a change to them is caught even when the dual-write is
 * correct.
 */

type Ctx = TestConvex<typeof schema>;

async function seedMinimalJob(
  t: Ctx,
): Promise<{ jobId: Id<"extractionJobs">; paperIds: Id<"extractionPapers">[] }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_agg_test",
      email: "agg@test.com",
      firstName: "A",
      lastName: "G",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });
    const jobId = await ctx.db.insert("extractionJobs", {
      userId,
      mode: "extraction" as const,
      sourceType: "history" as const,
      status: "extracting" as const,
      totalPapers: 5,
      processedPapers: 0,
      failedPapers: 0,
      name: "Agg test",
      createdAt: now,
      updatedAt: now,
    });
    const paperIds: Id<"extractionPapers">[] = [];
    for (let i = 0; i < 5; i++) {
      paperIds.push(
        await ctx.db.insert("extractionPapers", {
          jobId,
          openalexId: `oa:agg${i}`,
          title: `Paper ${i}`,
          status: "extracting" as const,
          processable: true,
        }),
      );
    }
    return { jobId, paperIds };
  });
}

async function insertResult(
  t: Ctx,
  jobId: Id<"extractionJobs">,
  paperId: Id<"extractionPapers">,
  result: {
    questionKey: string;
    answer: string | boolean | number | string[] | null;
    confidence?: number;
    citationStatus:
      | "grounded"
      | "best_effort"
      | "insufficient_evidence"
      | "extraction_error";
  },
): Promise<Id<"extractionResults">> {
  return await t.run(async (ctx) => {
    const id = await ctx.db.insert("extractionResults", {
      jobId,
      paperId,
      questionKey: result.questionKey,
      answer: result.answer,
      confidence: result.confidence,
      citations: [],
      citationStatus: result.citationStatus,
      processedAt: Date.now(),
    });
    const doc = (await ctx.db.get(id))!;
    await recordResult(ctx, doc);
    return id;
  });
}

describe("aggregates.recordResult + readAggregateCounters", () => {
  test("reading an empty (jobId, questionKey) returns all-zero counters", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId } = await seedMinimalJob(t);
    const counters = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "k"),
    );
    expect(counters).toEqual({
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
    });
  });

  test("one grounded result with confidence=0.9 produces 12-field counters bit-for-bit", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedMinimalJob(t);
    await insertResult(t, jobId, paperIds[0], {
      questionKey: "k",
      answer: "x",
      confidence: 0.9,
      citationStatus: "grounded",
    });
    const counters = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "k"),
    );
    expect(counters).toEqual({
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

  test("confidence bucket boundaries are inclusive-low (0.8 high, 0.5 medium, 0.49 low, undefined unknown)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedMinimalJob(t);
    const cases: Array<[number | undefined]> = [
      [0.8], // high
      [0.79], // medium
      [0.5], // medium
      [0.49], // low
      [undefined], // unknown
    ];
    for (let i = 0; i < cases.length; i++) {
      await insertResult(t, jobId, paperIds[i], {
        questionKey: "k",
        answer: "x",
        confidence: cases[i][0],
        citationStatus: "grounded",
      });
    }
    const c = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "k"),
    );
    expect(c.highConfidenceCount).toBe(1);
    expect(c.mediumConfidenceCount).toBe(2);
    expect(c.lowConfidenceCount).toBe(1);
    expect(c.unknownConfidenceCount).toBe(1);
    expect(c.totalPapers).toBe(5);
    expect(c.confidenceCount).toBe(4);
    expect(c.confidenceSum).toBeCloseTo(0.8 + 0.79 + 0.5 + 0.49);
  });

  test("null answer counts as unanswered (totalAnswered=0 but totalPapers=1)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedMinimalJob(t);
    await insertResult(t, jobId, paperIds[0], {
      questionKey: "k",
      answer: null,
      citationStatus: "insufficient_evidence",
    });
    const c = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "k"),
    );
    expect(c.totalPapers).toBe(1);
    expect(c.totalAnswered).toBe(0);
    expect(c.insufficientEvidenceCount).toBe(1);
  });

  test("citation-status mix across 4 statuses is summed correctly", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedMinimalJob(t);
    const statuses: Array<
      "grounded" | "best_effort" | "insufficient_evidence" | "extraction_error"
    > = ["grounded", "best_effort", "insufficient_evidence", "extraction_error"];
    for (let i = 0; i < 4; i++) {
      await insertResult(t, jobId, paperIds[i], {
        questionKey: "k",
        answer: "x",
        confidence: 0.9,
        citationStatus: statuses[i],
      });
    }
    const c = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "k"),
    );
    expect(c.groundedCount).toBe(1);
    expect(c.bestEffortCount).toBe(1);
    expect(c.insufficientEvidenceCount).toBe(1);
    expect(c.extractionErrorCount).toBe(1);
    expect(c.totalPapers).toBe(4);
  });

  test("recordResult is idempotent — calling twice for the same result does not double-count", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedMinimalJob(t);
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("extractionResults", {
        jobId,
        paperId: paperIds[0],
        questionKey: "k",
        answer: "x",
        confidence: 0.9,
        citations: [],
        citationStatus: "grounded" as const,
        processedAt: Date.now(),
      });
      const doc = (await ctx.db.get(id))!;
      await recordResult(ctx, doc);
      await recordResult(ctx, doc);
    });
    const c = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "k"),
    );
    expect(c.totalPapers).toBe(1);
    expect(c.groundedCount).toBe(1);
    expect(c.confidenceCount).toBe(1);
  });

  test("namespace isolation — two questions on same job do not cross-pollinate", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedMinimalJob(t);
    await insertResult(t, jobId, paperIds[0], {
      questionKey: "q1",
      answer: "a",
      confidence: 0.9,
      citationStatus: "grounded",
    });
    await insertResult(t, jobId, paperIds[1], {
      questionKey: "q2",
      answer: "b",
      confidence: 0.3,
      citationStatus: "best_effort",
    });
    const c1 = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "q1"),
    );
    const c2 = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "q2"),
    );
    expect(c1.groundedCount).toBe(1);
    expect(c1.bestEffortCount).toBe(0);
    expect(c2.groundedCount).toBe(0);
    expect(c2.bestEffortCount).toBe(1);
    expect(c1.highConfidenceCount).toBe(1);
    expect(c2.lowConfidenceCount).toBe(1);
  });
});

describe("aggregates.forgetResult", () => {
  test("removing a result zeroes its contribution to all 3 aggregates", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedMinimalJob(t);
    const resultId = await insertResult(t, jobId, paperIds[0], {
      questionKey: "k",
      answer: "x",
      confidence: 0.9,
      citationStatus: "grounded",
    });

    const before = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "k"),
    );
    expect(before.totalPapers).toBe(1);

    await t.run(async (ctx) => {
      const doc = (await ctx.db.get(resultId))!;
      await forgetResult(ctx, doc);
    });

    const after = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "k"),
    );
    expect(after.totalPapers).toBe(0);
    expect(after.groundedCount).toBe(0);
    expect(after.confidenceCount).toBe(0);
    expect(after.confidenceSum).toBe(0);
  });

  test("forgetResult is safe to call for a never-recorded result (deleteIfExists)", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedMinimalJob(t);
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("extractionResults", {
        jobId,
        paperId: paperIds[0],
        questionKey: "k",
        answer: "x",
        confidence: 0.9,
        citations: [],
        citationStatus: "grounded" as const,
        processedAt: Date.now(),
      });
      const doc = (await ctx.db.get(id))!;
      await forgetResult(ctx, doc);
    });
    const c = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "k"),
    );
    expect(c.totalPapers).toBe(0);
  });
});

describe("aggregates.clearJobAggregates", () => {
  test("dropping all aggregates for a job zeroes every (jobId, *) key", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedMinimalJob(t);
    await insertResult(t, jobId, paperIds[0], {
      questionKey: "q1",
      answer: "a",
      confidence: 0.9,
      citationStatus: "grounded",
    });
    await insertResult(t, jobId, paperIds[1], {
      questionKey: "q2",
      answer: "b",
      confidence: 0.3,
      citationStatus: "best_effort",
    });

    await t.run(async (ctx) => {
      await clearJobAggregates(ctx, jobId, ["q1", "q2"]);
    });

    const c1 = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "q1"),
    );
    const c2 = await t.run(async (ctx) =>
      readAggregateCounters(ctx, jobId, "q2"),
    );
    expect(c1.totalPapers).toBe(0);
    expect(c1.groundedCount).toBe(0);
    expect(c2.totalPapers).toBe(0);
    expect(c2.bestEffortCount).toBe(0);
  });
});

describe("aggregates.readAggregateSummariesByQuestion", () => {
  test("empty question list returns empty array", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId } = await seedMinimalJob(t);
    const summaries = await t.run(async (ctx) =>
      readAggregateSummariesByQuestion(ctx, jobId, []),
    );
    expect(summaries).toEqual([]);
  });

  test("questions with zero activity still surface as zero rows", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId } = await seedMinimalJob(t);
    const summaries = await t.run(async (ctx) =>
      readAggregateSummariesByQuestion(ctx, jobId, ["q1", "q2"]),
    );
    expect(summaries).toEqual([
      {
        questionKey: "q1",
        totalPapers: 0,
        totalAnswered: 0,
        groundedCount: 0,
        bestEffortCount: 0,
        confidenceSum: 0,
        confidenceCount: 0,
      },
      {
        questionKey: "q2",
        totalPapers: 0,
        totalAnswered: 0,
        groundedCount: 0,
        bestEffortCount: 0,
        confidenceSum: 0,
        confidenceCount: 0,
      },
    ]);
  });

  test("per-question summary matches the aggregate state", async () => {
    const t = convexTest(schema);
    setupAggregates(t);
    const { jobId, paperIds } = await seedMinimalJob(t);
    await insertResult(t, jobId, paperIds[0], {
      questionKey: "q1",
      answer: "a",
      confidence: 0.9,
      citationStatus: "grounded",
    });
    await insertResult(t, jobId, paperIds[1], {
      questionKey: "q1",
      answer: null,
      citationStatus: "insufficient_evidence",
    });
    await insertResult(t, jobId, paperIds[2], {
      questionKey: "q2",
      answer: "b",
      confidence: 0.6,
      citationStatus: "best_effort",
    });
    const summaries = await t.run(async (ctx) =>
      readAggregateSummariesByQuestion(ctx, jobId, ["q1", "q2"]),
    );
    expect(summaries).toEqual([
      {
        questionKey: "q1",
        totalPapers: 2,
        totalAnswered: 1,
        groundedCount: 1,
        bestEffortCount: 0,
        confidenceSum: 0.9,
        confidenceCount: 1,
      },
      {
        questionKey: "q2",
        totalPapers: 1,
        totalAnswered: 1,
        groundedCount: 0,
        bestEffortCount: 1,
        confidenceSum: 0.6,
        confidenceCount: 1,
      },
    ]);
  });
});
