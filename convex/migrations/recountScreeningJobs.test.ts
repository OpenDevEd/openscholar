// Screen all jobs saved before #383 count their progress in aggregates; the migration counts
// each into its sharded counters from its results, and a running one still finishes after.
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { insertMany } from "../lib/maxSize.test-support";
import { readScreeningProgressCounts } from "../screening/aggregates";
import { setupScreeningWorkpool } from "../screening/workpool.test-support";
import { encodeQuestionResponseMap } from "../../lib/ai/core/question-key-codec";

const questions = [{ key: "q1", question: "Is this relevant?" }];
const scoringConfig = { rules: [{ questionKey: "q1", yesPoints: 1, noPoints: 0, nullPoints: 0 }], starThresholds: [{ minScore: 0, stars: 1 }] };
const result = (jobId: Id<"screeningJobs">, i: number, status: "completed" | "failed" | "skipped" | "processing", qualified?: boolean) => ({
  jobId, openalexId: `https://openalex.org/W${i}`, title: `Paper ${i}`, status, createdAt: 1, ...(qualified === undefined ? {} : { qualified }),
});

describe("recountScreeningJobs", () => {
  it("counts each older job from its results once, and a running one finishes after", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      setupScreeningWorkpool(t);
      const { finished, running, runningResult } = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { clerkId: "alice", email: "a@test", state: "active", createdAt: 1, updatedAt: 1 });
        const job = (status: "completed" | "processing", totalPapers: number) => ctx.db.insert("screeningJobs", { userId, status, totalPapers, questions, scoringConfig, createdAt: 1, updatedAt: 1 });
        const finished = await job("completed", 4);
        for (const [i, status, qualified] of [[0, "completed", true], [1, "completed", false], [2, "failed"], [3, "skipped"]] as const) await ctx.db.insert("screeningResults", result(finished, i, status, qualified));
        const running = await job("processing", 2);
        await ctx.db.insert("screeningResults", result(running, 10, "completed", true));
        const runningResult = await ctx.db.insert("screeningResults", result(running, 11, "processing"));
        return { finished, running, runningResult };
      });
      expect(await t.action(internal.migrations.recountScreeningJobs.verify, {})).toMatchObject({ wrong: 2 });

      await t.mutation(internal.migrations.recountScreeningJobs.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.action(internal.migrations.recountScreeningJobs.verify, {})).toEqual({ wrong: 0, sample: [] });
      const counts = (jobId: Id<"screeningJobs">) => t.run(async (ctx) => readScreeningProgressCounts(ctx, (await ctx.db.get("screeningJobs", jobId))!));
      expect(await counts(finished)).toEqual({ completedCount: 1 + 1, skippedCount: 1, failedCount: 1, qualifiedCount: 1 });

      // The running job's last paper finishes on the counters, and the job with it.
      await t.mutation(internal.screening.mutations.handleScreeningComplete, {
        workId: "last", context: { jobId: running, resultId: runningResult },
        result: { kind: "success", returnValue: { responses: encodeQuestionResponseMap({ "Is this relevant?": true }), confidences: {}, confidence: 0.9 } },
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await counts(running)).toEqual({ completedCount: 2, skippedCount: 0, failedCount: 0, qualifiedCount: 2 });
      expect((await t.run((ctx) => ctx.db.get("screeningJobs", running)))?.status).toBe("completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it(`recounts a job of ${MAX_SCREENING_PAPERS_PER_JOB} papers within Convex's limits`, async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest({ schema, transactionLimits: true });
      const jobId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { clerkId: "alice", email: "a@test", state: "active", createdAt: 1, updatedAt: 1 });
        return ctx.db.insert("screeningJobs", { userId, status: "completed", totalPapers: MAX_SCREENING_PAPERS_PER_JOB, questions, scoringConfig, createdAt: 1, updatedAt: 1 });
      });
      await insertMany(t, "screeningResults", Array.from({ length: MAX_SCREENING_PAPERS_PER_JOB }, (_, i) => ({ ...result(jobId, i, "completed", i % 3 === 0), abstract: "An abstract of an ordinary length. ".repeat(40) })), 250);
      await t.mutation(internal.migrations.recountScreeningJobs.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.action(internal.migrations.recountScreeningJobs.verify, {})).toEqual({ wrong: 0, sample: [] });
    } finally {
      vi.useRealTimers();
    }
  }, 300_000);
});
