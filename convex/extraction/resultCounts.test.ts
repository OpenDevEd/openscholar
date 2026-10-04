// A job's counts stay equal to a recount of its rows through every kind of write, folded by
// the counts worker (./counts.ts).
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import { seedAccount } from "../lib/maxSize.test-support";
import { countMismatches } from "./counts.test-support";

type Test = ReturnType<typeof convexTest>;
const verify = async (t: Test) => ({ mismatches: await countMismatches(t) });
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
    expect(await as.query(api.extraction.queries.countJobFailures, { jobId })).toEqual({ asked: 5, answered: 1, retryable: 2, permanent: { moderation: 1, pdf_invalid: 1 }, paperErrors: { pdf_invalid: 2 } });

    await t.run(async (ctx) => {
      await ctx.db.patch("extractionResults", results[1], { ...completed, lastError: undefined });
      await ctx.db.replace("extractionResults", results[4], { jobId, paperId: papers[2], questionKey: "q1", citations: [], billed: false, attemptCount: 2, processedAt: 2, ...failed("auth") });
      await ctx.db.delete("extractionResults", results[3]);
      await ctx.db.patch("extractionPapers", papers[2], { status: "download_failed" });
      await ctx.db.patch("extractionPapers", papers[0], { status: "extracting" });
    });
    expect(await verify(t)).toMatchObject({ mismatches: [] });
    await folded(t);
    expect(await as.query(api.extraction.queries.countJobFailures, { jobId })).toMatchObject({ asked: 4, answered: 2, retryable: 0, permanent: { auth: 1, pdf_invalid: 1 } });
  });

  it("show someone else's job, and a job with nothing counted, as zeros", async () => {
    const t = convexTest(schema);
    const { userId, as } = await seedAccount(t);
    const { jobId } = await seedJob(t, userId);
    await folded(t);
    const zeros = { asked: 0, answered: 0, retryable: 0, permanent: {}, paperErrors: {} };
    await t.run((ctx) => ctx.db.insert("users", { clerkId: "clerk_someone_else", email: "else@example.org", state: "active", createdAt: 1, updatedAt: 1 }));
    const other = t.withIdentity({ tokenIdentifier: "https://test.clerk.local|clerk_someone_else", subject: "clerk_someone_else", issuer: "https://test.clerk.local" });
    expect(await other.query(api.extraction.queries.countJobFailures, { jobId })).toEqual(zeros);

    const empty = await t.run((ctx) => ctx.db.insert("extractionJobs", { userId, mode: "extraction", name: "Nothing yet", totalPapers: 0, createdAt: 1, updatedAt: 1 }));
    expect(await as.query(api.extraction.queries.countJobFailures, { jobId: empty })).toEqual(zeros);
  });
});
