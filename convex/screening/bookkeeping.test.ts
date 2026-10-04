// Screen all's bookkeeping worker: a finished paper writes only its row; the worker counts
// it, saves it if it qualified, moves its answers, and finishes the job, each exactly once.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { bookkeepLater, progressRow } from "./bookkeeping";
import { setupScreeningWorkpool } from "./workpool.test-support";

const questions = [{ key: "q1", question: "Is this relevant?" }];
const scoringConfig = { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 0, stars: 1 }], minimumScore: 1 };
type Finished = { status: "completed" | "skipped" | "failed"; qualified?: boolean; answered?: boolean; abstract?: string };

// The worker schedules its runs on whichever timers are active when papers finish.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function seedJob(t: ReturnType<typeof convexTest>, totalPapers: number, withProgress = true) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: `clerk_${totalPapers}_${Math.random()}`, email: "a@test", state: "active", createdAt: 1, updatedAt: 1 });
    const screeningId = await ctx.db.insert("screenings", { userId, version: 0, createdAt: 1 });
    const jobId = await ctx.db.insert("screeningJobs", { userId, status: "processing", totalPapers, questions, scoringConfig, screeningId, createdAt: 1, updatedAt: 1 });
    if (withProgress) await ctx.db.insert("screeningJobProgress", { jobId, completed: 0, skipped: 0, failed: 0, qualified: 0 });
    return { userId, jobId, screeningId };
  });
}

/** Papers finished in one transaction, as a workpool completion finishes them: stamped and queued. */
function finish(ctx: MutationCtx, jobId: Id<"screeningJobs">, papers: Array<Finished & { i: number }>, stamped = true) {
  return Promise.all(
    papers.map(({ i, status, qualified, answered, abstract }) =>
      ctx.db.insert("screeningResults", {
        jobId,
        openalexId: `https://openalex.org/W${i}`,
        title: `Paper ${i}`,
        ...(abstract ? { abstract } : {}),
        status,
        createdAt: 1,
        completedAt: 2,
        ...(qualified === undefined ? {} : { qualified, score: qualified ? 1 : 0, stars: 1 }),
        ...(answered ? { answers: { q1: qualified ?? true }, confidences: { q1: 0.9 }, pendingAnswers: true as const } : {}),
        ...(stamped ? { doneAt: ctx.db.vars.commitTs } : {}),
      }),
    ),
  );
}

const counts = (t: ReturnType<typeof convexTest>, jobId: Id<"screeningJobs">) =>
  t.run(async (ctx) => {
    const row = await progressRow(ctx, jobId);
    return row && { completed: row.completed, skipped: row.skipped, failed: row.failed, qualified: row.qualified };
  });

describe("Screen all bookkeeping", () => {
  it("counts papers finishing in one transaction once each, saves the qualified, moves answers, and finishes the job", async () => {
    const t = convexTest(schema);
    setupScreeningWorkpool(t);
    const { userId, jobId, screeningId } = await seedJob(t, 4);

    await t.run(async (ctx) => {
      await finish(ctx, jobId, [
        { i: 1, status: "completed", qualified: true, answered: true },
        { i: 2, status: "completed", qualified: false, answered: true },
        { i: 3, status: "failed" },
      ]);
      await bookkeepLater(ctx);
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await counts(t, jobId)).toEqual({ completed: 2, skipped: 0, failed: 1, qualified: 1 });
    expect((await t.run((ctx) => ctx.db.get("screeningJobs", jobId)))?.status).toBe("processing");

    await t.run(async (ctx) => {
      await finish(ctx, jobId, [{ i: 4, status: "skipped" }]);
      await bookkeepLater(ctx);
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await counts(t, jobId)).toEqual({ completed: 2, skipped: 1, failed: 1, qualified: 1 });
    expect((await t.run((ctx) => ctx.db.get("screeningJobs", jobId)))?.status).toBe("completed");
    const library = await t.run((ctx) => ctx.db.query("libraryItems").withIndex("by_user_openalexId", (q) => q.eq("userId", userId)).collect());
    expect(library.map((item) => item.openalexId)).toEqual(["https://openalex.org/W1"]);
    const answers = await t.run((ctx) => ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId)).collect());
    expect(answers).toHaveLength(2);
    const results = await t.run((ctx) => ctx.db.query("screeningResults").collect());
    expect(results.filter((result) => result.pendingAnswers)).toHaveLength(0);
  });

  it(`bookkeeps a ${MAX_SCREENING_PAPERS_PER_JOB}-paper job within Convex's limits`, async () => {
    const t = convexTest({ schema, transactionLimits: true });
    setupScreeningWorkpool(t);
    const { jobId } = await seedJob(t, MAX_SCREENING_PAPERS_PER_JOB);
    const papers = (from: number, count: number) =>
      Array.from({ length: count }, (_, k) => ({ i: from + k, status: "completed" as const, qualified: (from + k) % 3 === 0, answered: true }));
    for (let from = 0; from < MAX_SCREENING_PAPERS_PER_JOB; from += 250) {
      await t.run(async (ctx) => {
        await finish(ctx, jobId, papers(from, 250));
        await bookkeepLater(ctx);
      });
    }

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const qualified = Array.from({ length: MAX_SCREENING_PAPERS_PER_JOB }, (_, i) => i).filter((i) => i % 3 === 0).length;
    expect(await counts(t, jobId)).toEqual({ completed: MAX_SCREENING_PAPERS_PER_JOB, skipped: 0, failed: 0, qualified });
    expect((await t.run((ctx) => ctx.db.get("screeningJobs", jobId)))?.status).toBe("completed");
  }, 600_000);
});
