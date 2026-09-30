// A job's counters stay equal to a recount of its rows through every kind of write (#351),
// and the recount migration repairs counters that were saved before they were kept.
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedAccount } from "../lib/maxSize.test-support";
import { setJobCounters } from "./jobCounters";
import { setPaperErrorCounts, setResultCounts } from "./resultCounts";

type Test = ReturnType<typeof convexTest>;
const verify = (t: Test) => t.query(internal.migrations.recountExtractionJobs.verify, { paginationOpts: { cursor: null, numItems: 20 } });
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
    expect(await as.query(api.extraction.queries.retry.getRetryableSummary, { jobId })).toEqual({ retryableCount: 0, permanentCount: 2, permanentBreakdown: { auth: 1, pdf_invalid: 1 } });
    expect(await as.query(api.extraction.queries.mixedSuccessSummary.getMixedSuccessSummary, { jobId })).toMatchObject({ answeredTotal: 2, totalQuestions: 4 });
  });

  it("are set right by the recount migration for jobs saved before counting", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const { userId } = await seedAccount(t);
      const { jobId } = await seedJob(t, userId);
      // As a job saved before the counters: nothing counted, or counted wrong.
      await t.run(async (ctx) => {
        await setJobCounters(ctx, jobId, { processed: 7, failed: 0 });
        await setResultCounts(ctx, jobId, new Map());
        await setPaperErrorCounts(ctx, jobId, new Map([["network", 3]]));
      });
      expect((await verify(t)).mismatches).toHaveLength(1);
      await t.mutation(internal.migrations.recountExtractionJobs.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await verify(t)).toMatchObject({ mismatches: [] });
    } finally {
      vi.useRealTimers();
    }
  });
});
