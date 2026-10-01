// A finished Screen all paper waits on its result until the job's one writer moves its answers
// into the screening, a batch per transaction (#334).
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { setupScreeningWorkpool } from "./workpool.test-support";

describe("drainJobAnswers", () => {
  it("moves every pending answer, queueing another batch while a full one is left", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest({ schema, transactionLimits: true });
      setupScreeningWorkpool(t);
      const jobId = await t.run(async (ctx) => {
        const userId = await ctx.db.insert("users", { libraryItemCount: 0, clerkId: "alice", email: "a@test", state: "active", createdAt: 1, updatedAt: 1 });
        const screeningId = await ctx.db.insert("screenings", { userId, version: 0, createdAt: 1 });
        const jobId = await ctx.db.insert("screeningJobs", {
          userId, status: "processing", totalPapers: 150, questions: [{ key: "q0", question: "Randomized?" }], scoringConfig: { rules: [], starThresholds: [] }, screeningId, createdAt: 1, updatedAt: 1,
        });
        for (let i = 0; i < 150; i++) {
          await ctx.db.insert("screeningResults", {
            jobId, openalexId: `https://openalex.org/W${i}`, title: `Paper ${i}`, status: "completed", createdAt: 1, completedAt: 2,
            answers: { q0: i % 2 === 0 }, confidences: { q0: 0.8 }, pendingAnswers: true,
          });
        }
        return jobId;
      });

      await t.mutation(internal.screening.drain.drainJobAnswers, { jobId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const { pending, answers } = await t.run(async (ctx) => {
        const job = (await ctx.db.get("screeningJobs", jobId))!;
        return {
          pending: (await ctx.db.query("screeningResults").withIndex("by_job_and_pendingAnswers", (q) => q.eq("jobId", jobId).eq("pendingAnswers", true)).collect()).length,
          answers: await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", job.screeningId!)).collect(),
        };
      });
      expect(pending).toBe(0);
      expect(answers).toHaveLength(150);
      expect(answers.every((row) => row.answers[0].model?.confidence === 0.8 && row.answers[0].answer === (Number(row.paperId.slice(22)) % 2 === 0))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
