// An extraction job's counts: writes append changes, one worker folds them into the job's
// counts row, and reads are exact before and after the fold.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { PAPER_LIMIT } from "../../lib/extraction/limits";
import { readJobCounters } from "./jobCounters";
import { readResultCounts } from "./resultCounts";
import { ShardedCounter } from "@convex-dev/sharded-counter";
import { components } from "../_generated/api";

// The worker schedules its runs on whichever timers are active when counts change.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function seedJob(t: ReturnType<typeof convexTest>, totalPapers: number) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { clerkId: `clerk_${Math.random()}`, email: "x@test", state: "active", createdAt: 1, updatedAt: 1 });
    return await ctx.db.insert("extractionJobs", { userId, mode: "extraction", sourceType: "history", status: "extracting", totalPapers, runEpoch: 0, name: "Counted", createdAt: 1, updatedAt: 1 });
  });
}

const counts = (t: ReturnType<typeof convexTest>, jobId: Id<"extractionJobs">) =>
  t.run(async (ctx) => ({ papers: await readJobCounters(ctx, jobId), results: await readResultCounts(ctx, jobId) }));

describe("extraction counts", () => {
  it("are exact before the worker folds them and after, and the job finishes once from the fold", async () => {
    const t = convexTest(schema);
    const jobId = await seedJob(t, 2);
    await t.run(async (ctx) => {
      for (const [i, status] of (["completed", "extracting"] as const).entries()) {
        const paperId = await ctx.db.insert("extractionPapers", { jobId, openalexId: `oa:${i}`, title: `${i}`, status, processable: true });
        await ctx.db.insert("extractionResults", { jobId, paperId, questionKey: "q1", answer: "a", citations: [], citationStatus: "grounded", status: "completed", billed: true, attemptCount: 1, processedAt: 1 });
      }
    });
    const expected = { papers: { processed: 1, failed: 0 }, results: { total: 2, completed: 2, retryable: 0, permanent: {} } };
    expect(await counts(t, jobId)).toEqual(expected);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await counts(t, jobId)).toEqual(expected);
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("extracting");

    await t.run(async (ctx) => {
      const paper = (await ctx.db.query("extractionPapers").collect()).find((p) => p.status === "extracting")!;
      await ctx.db.patch(paper._id, { status: "failed" });
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect((await counts(t, jobId)).papers).toEqual({ processed: 1, failed: 1 });
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("completed");
  });

  it("go with a deleted job, changes the worker hadn't folded included", async () => {
    const t = convexTest(schema);
    const jobId = await seedJob(t, 1);
    await t.run(async (ctx) => {
      await ctx.db.insert("extractionPapers", { jobId, openalexId: "oa:1", title: "1", status: "completed", processable: true });
      await ctx.db.delete("extractionJobs", jobId);
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run(async (ctx) => [...(await ctx.db.query("extractionJobCounts").collect()), ...(await ctx.db.query("extractionCountChanges").collect())])).toEqual([]);
  });

  it(`start a ${PAPER_LIMIT}-paper job saved before them from a recount within Convex's limits`, async () => {
    const t = convexTest({ schema, transactionLimits: true });
    const jobId = await seedJob(t, PAPER_LIMIT);
    for (let from = 0; from < PAPER_LIMIT; from += 100) {
      await t.run(async (ctx) => {
        for (let i = from; i < from + 100; i++) {
          const paperId = await ctx.db.insert("extractionPapers", { jobId, openalexId: `oa:${i}`, title: `Paper ${i}`, status: "completed", processable: true });
          for (const questionKey of ["q1", "q2", "q3"]) {
            await ctx.db.insert("extractionResults", { jobId, paperId, questionKey, answer: "An answer of ordinary length. ".repeat(10), citations: [], citationStatus: "grounded", status: "completed", billed: true, attemptCount: 1, processedAt: 1 });
          }
        }
      });
    }
    // As a job saved before: no counts row and no changes.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("extractionJobCounts").collect()) await ctx.db.delete("extractionJobCounts", row._id);
      for (const change of await ctx.db.query("extractionCountChanges").collect()) await ctx.db.delete("extractionCountChanges", change._id);
    });

    await t.mutation(internal.migrations.moveExtractionCounts.run, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await counts(t, jobId)).toEqual({ papers: { processed: PAPER_LIMIT, failed: 0 }, results: { total: 3 * PAPER_LIMIT, completed: 3 * PAPER_LIMIT, retryable: 0, permanent: {} } });
    expect(await t.action(internal.migrations.moveExtractionCounts.verify, {})).toEqual({ wrong: 0, sample: [] });
  }, 600_000);

  it("start a job saved before them from the old counters, without recounting its rows", async () => {
    const t = convexTest(schema);
    const jobId = await seedJob(t, 5);
    await t.run(async (ctx) => {
      // As a job saved before: no counts row or changes, and its counts in the old counters.
      for (const row of await ctx.db.query("extractionJobCounts").collect()) await ctx.db.delete("extractionJobCounts", row._id);
      const processed = new ShardedCounter<Id<"extractionJobs">>(components.extractionProcessedCounter, { defaultShards: 64 });
      await processed.add(ctx, jobId, 3);
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("extractionPapers", { jobId, openalexId: "oa:new", title: "new", status: "completed", processable: true });
    });

    expect((await counts(t, jobId)).papers).toEqual({ processed: 4, failed: 0 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await counts(t, jobId)).papers).toEqual({ processed: 4, failed: 0 });
  });

  it("don't let a job finish while changes wait to be folded, such as a retry putting a paper back", async () => {
    const t = convexTest(schema);
    const jobId = await seedJob(t, 1);
    const paperId = await t.run((ctx) => ctx.db.insert("extractionPapers", { jobId, openalexId: "oa:1", title: "1", status: "completed", processable: true }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.run((ctx) => ctx.db.patch(jobId, { status: "extracting", retryReset: undefined }));
    // A retry puts the paper back; the change waits for the worker.
    await t.run((ctx) => ctx.db.patch(paperId, { status: "extracting" }));
    await t.run((ctx) => ctx.db.patch(jobId, { status: "extracting" }));

    await t.mutation(internal.extraction.mutations.internal.lifecycle.maybeFinalizeJob, { jobId });
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("extracting");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.status).toBe("extracting");
    expect((await counts(t, jobId)).papers).toEqual({ processed: 0, failed: 0 });
  });
});
