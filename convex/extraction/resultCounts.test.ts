// A job's counts stay equal to a recount of its rows through every kind of write, folded by
// the counts worker (./counts.ts), and the migration gives jobs saved before it their row.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedAccount } from "../lib/maxSize.test-support";

type Test = ReturnType<typeof convexTest>;
const verify = async (t: Test) => ({ mismatches: (await t.action(internal.migrations.moveExtractionCounts.verify, {})).sample });
/** The counts worker folds the changes a moment after they're written. */
const folded = (t: Test) => t.finishAllScheduledFunctions(vi.runAllTimers);

// The worker schedules its runs on whichever timers are active when counts change.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const failed = (code: string) => ({ status: "failed" as const, answer: null, citationStatus: "extraction_error" as const, lastError: { code: code as never, message: code, at: 1 } });
const completed = { status: "completed" as const, answer: "ok", citationStatus: "grounded" as const };

async function seedJob(t: Test, userId: Id<"users">) {
  return t.run(async (ctx) => {
    const jobId = await ctx.db.insert("extractionJobs", { userId, mode: "extraction", sourceType: "history", status: "extracting", totalPapers: 3, runEpoch: 0, name: "Counted", createdAt: 1, updatedAt: 1 });
    const papers = [];
    for (const status of ["completed", "failed", "extracting"] as const) {
      papers.push(await ctx.db.insert("extractionPapers", { jobId, openalexId: `oa:${status}`, title: status, status }));
    }
    const result = (paperId: Id<"extractionPapers">, questionKey: string, fields: typeof completed | ReturnType<typeof failed>) =>
      ctx.db.insert("extractionResults", { jobId, paperId, questionKey, citations: [], billed: false, attemptCount: 1, processedAt: 1, ...fields });
    const results = [
      await result(papers[0], "q1", completed),
      await result(papers[0], "q2", failed("rate_limit")),
      await result(papers[1], "q1", failed("pdf_invalid")),
      await result(papers[1], "q2", failed("moderation")),
      await result(papers[2], "q1", failed("network")),
    ];
    await ctx.db.insert("extractionPaperErrors", { jobId, paperId: papers[1], attempt: 1, at: 1, code: "pdf_invalid", message: "bad pdf" });
    await ctx.db.insert("extractionPaperErrors", { jobId, paperId: papers[1], attempt: 2, at: 2, code: "pdf_invalid", message: "bad pdf" });
    return { jobId, papers, results };
  });
}

describe("extraction job counters", () => {
  it("match a recount of the job's rows through inserts, updates, replaces and deletes", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    const { jobId, papers, results } = await seedJob(t, userId);
    expect(await verify(t)).toMatchObject({ mismatches: [] });
    await folded(t);
    expect(await as.query(api.extraction.queries.retry.getRetryableSummary, { jobId })).toEqual({ retryableCount: 2, permanentCount: 2, permanentBreakdown: { moderation: 1, pdf_invalid: 1 } });
    expect(await as.query(api.extraction.queries.mixedSuccessSummary.getMixedSuccessSummary, { jobId })).toMatchObject({ total: 2, answeredTotal: 1, totalQuestions: 5 });

    await t.run(async (ctx) => {
      await ctx.db.patch("extractionResults", results[1], { ...completed, lastError: undefined });
      await ctx.db.replace("extractionResults", results[4], { jobId, paperId: papers[2], questionKey: "q1", citations: [], billed: false, attemptCount: 2, processedAt: 2, ...failed("auth") });
      await ctx.db.delete("extractionResults", results[3]);
      await ctx.db.patch("extractionPapers", papers[2], { status: "download_failed" });
      await ctx.db.patch("extractionPapers", papers[0], { status: "extracting" });
    });
    expect(await verify(t)).toMatchObject({ mismatches: [] });
    await folded(t);
    expect(await as.query(api.extraction.queries.retry.getRetryableSummary, { jobId })).toEqual({ retryableCount: 0, permanentCount: 2, permanentBreakdown: { auth: 1, pdf_invalid: 1 } });
    expect(await as.query(api.extraction.queries.mixedSuccessSummary.getMixedSuccessSummary, { jobId })).toMatchObject({ answeredTotal: 2, totalQuestions: 4 });
  });

  it("are given to jobs saved before the counts row by the migration, with writes waiting for the worker counted once", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    const { jobId, papers } = await seedJob(t, userId);
    // As a job saved before: no counts row and no changes, then one write after the deploy.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("extractionJobCounts").collect()) await ctx.db.delete("extractionJobCounts", row._id);
      for (const change of await ctx.db.query("extractionCountChanges").collect()) await ctx.db.delete("extractionCountChanges", change._id);
      await ctx.db.patch("extractionPapers", papers[2], { status: "completed" });
    });
    expect((await verify(t)).mismatches).toHaveLength(1);

    await t.mutation(internal.migrations.moveExtractionCounts.run, {});
    await folded(t);

    expect(await verify(t)).toMatchObject({ mismatches: [] });
    expect(await as.query(api.extraction.queries.mixedSuccessSummary.getMixedSuccessSummary, { jobId })).toMatchObject({ total: 2, totalQuestions: 5 });
  });
});
