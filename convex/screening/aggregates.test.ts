import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import {
  clearScreeningAggregates,
  forgetQualifiedResult,
  forgetTerminalResult,
  readScreeningProgressCounts,
  recordQualifiedResult,
  recordTerminalResult,
} from "./aggregates";
import { setupScreeningAggregates } from "./aggregates.test-support";

type Ctx = TestConvex<typeof schema>;

async function seedJob(t: Ctx): Promise<Id<"screeningJobs">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      clerkId: "clerk_screening_agg",
      email: "screening-agg@test.com",
      firstName: "Screening",
      lastName: "Agg",
      state: "active" as const,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    });

    return await ctx.db.insert("screeningJobs", {
      userId,
      status: "processing",
      totalPapers: 10,
      processedPapers: 0,
      failedPapers: 0,
      qualifiedPapers: 0,
      questions: [{ key: "q1", question: "Relevant?" }],
      scoringConfig: {
        rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }],
        starThresholds: [{ minScore: 0, stars: 1 }],
      },
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function insertResult(
  t: Ctx,
  jobId: Id<"screeningJobs">,
  overrides: Partial<{
    openalexId: string;
    title: string;
    status: "processing" | "completed" | "failed" | "skipped";
    qualified: boolean;
  }> = {},
) {
  return await t.run(async (ctx) => {
    const createdAt = Date.now();
    const resultId = await ctx.db.insert("screeningResults", {
      jobId,
      openalexId:
        overrides.openalexId ??
        `https://openalex.org/W${createdAt}${String(jobId).slice(-4)}`,
      title: overrides.title ?? "Aggregate Test Paper",
      status: overrides.status ?? "completed",
      ...(overrides.qualified !== undefined
        ? { qualified: overrides.qualified }
        : {}),
      createdAt,
    });
    return (await ctx.db.get("screeningResults", resultId))!;
  });
}

describe("screening aggregates", () => {
  test("reading an empty job returns all-zero counts", async () => {
    const t = convexTest(schema);
    setupScreeningAggregates(t);
    const jobId = await seedJob(t);

    await expect(
      t.run(async (ctx) => readScreeningProgressCounts(ctx, jobId)),
    ).resolves.toEqual({
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      qualifiedCount: 0,
    });
  });

  test("terminal statuses and qualified results are counted independently", async () => {
    const t = convexTest(schema);
    setupScreeningAggregates(t);
    const jobId = await seedJob(t);

    const completedQualified = await insertResult(t, jobId, {
      status: "completed",
      qualified: true,
    });
    const skipped = await insertResult(t, jobId, { status: "skipped" });
    const failed = await insertResult(t, jobId, { status: "failed" });

    await t.run(async (ctx) => {
      await recordTerminalResult(ctx, completedQualified);
      await recordQualifiedResult(ctx, completedQualified);
      await recordTerminalResult(ctx, skipped);
      await recordTerminalResult(ctx, failed);
    });

    await expect(
      t.run(async (ctx) => readScreeningProgressCounts(ctx, jobId)),
    ).resolves.toEqual({
      completedCount: 1,
      skippedCount: 1,
      failedCount: 1,
      qualifiedCount: 1,
    });
  });

  test("record helpers are idempotent under replay", async () => {
    const t = convexTest(schema);
    setupScreeningAggregates(t);
    const jobId = await seedJob(t);
    const completedQualified = await insertResult(t, jobId, {
      status: "completed",
      qualified: true,
    });

    await t.run(async (ctx) => {
      await recordTerminalResult(ctx, completedQualified);
      await recordTerminalResult(ctx, completedQualified);
      await recordQualifiedResult(ctx, completedQualified);
      await recordQualifiedResult(ctx, completedQualified);
    });

    await expect(
      t.run(async (ctx) => readScreeningProgressCounts(ctx, jobId)),
    ).resolves.toEqual({
      completedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      qualifiedCount: 1,
    });
  });

  test("forget helpers remove a result from both aggregates", async () => {
    const t = convexTest(schema);
    setupScreeningAggregates(t);
    const jobId = await seedJob(t);
    const completedQualified = await insertResult(t, jobId, {
      status: "completed",
      qualified: true,
    });

    await t.run(async (ctx) => {
      await recordTerminalResult(ctx, completedQualified);
      await recordQualifiedResult(ctx, completedQualified);
      await forgetQualifiedResult(ctx, completedQualified);
      await forgetTerminalResult(ctx, completedQualified);
    });

    await expect(
      t.run(async (ctx) => readScreeningProgressCounts(ctx, jobId)),
    ).resolves.toEqual({
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      qualifiedCount: 0,
    });
  });

  test("clearScreeningAggregates only wipes the targeted job namespace", async () => {
    const t = convexTest(schema);
    setupScreeningAggregates(t);
    const jobId = await seedJob(t);
    const otherJobId = await seedJob(t);
    const firstJobResult = await insertResult(t, jobId, {
      status: "failed",
    });
    const otherJobResult = await insertResult(t, otherJobId, {
      status: "completed",
      qualified: true,
    });

    await t.run(async (ctx) => {
      await recordTerminalResult(ctx, firstJobResult);
      await recordTerminalResult(ctx, otherJobResult);
      await recordQualifiedResult(ctx, otherJobResult);
      await clearScreeningAggregates(ctx, jobId);
    });

    await expect(
      t.run(async (ctx) => readScreeningProgressCounts(ctx, jobId)),
    ).resolves.toEqual({
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      qualifiedCount: 0,
    });

    await expect(
      t.run(async (ctx) => readScreeningProgressCounts(ctx, otherJobId)),
    ).resolves.toEqual({
      completedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      qualifiedCount: 1,
    });
  });
});
