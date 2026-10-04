// An extraction job's counts: writes append changes, one worker folds them into the job's
// counts row, and reads are exact before and after the fold.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { readJobCounters } from "./jobCounters";
import { readResultCounts } from "./resultCounts";

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
