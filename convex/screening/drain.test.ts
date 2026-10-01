// A finished Screen all paper waits on its result until the job's one writer moves its answers
// into the screening, a batch per transaction (#334).
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { answerPaper } from "../research/answers";
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

describe("Screen all answers next to a person's", () => {
  async function seedJob(t: TestConvex<typeof schema>, questions: Array<{ key: string; question: string }>) {
    return t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { libraryItemCount: 0, clerkId: "alice", email: "a@test", state: "active", createdAt: 1, updatedAt: 1 });
      const screeningId = await ctx.db.insert("screenings", { userId, version: 0, createdAt: 1 });
      const jobId = await ctx.db.insert("screeningJobs", { userId, status: "completed", totalPapers: 1, questions, scoringConfig: { rules: [], starThresholds: [] }, screeningId, createdAt: 1, updatedAt: 1 });
      return { userId, screeningId, jobId };
    });
  }
  const finish = (t: TestConvex<typeof schema>, jobId: Id<"screeningJobs">, answers: Record<string, boolean | null>, confidences: Record<string, number>, completedAt: number) =>
    t.run((ctx) => ctx.db.insert("screeningResults", { jobId, openalexId: "https://openalex.org/W1", title: "P", status: "completed", createdAt: 1, completedAt, score: 1, stars: 1, qualified: true, answers, confidences, pendingAnswers: true }));
  const row = (t: TestConvex<typeof schema>, screeningId: Id<"screenings">) =>
    t.run(async (ctx) => (await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId).eq("paperId", "https://openalex.org/W1")).unique())!.answers);
  const exported = async (t: TestConvex<typeof schema>, jobId: Id<"screeningJobs">) =>
    (await t.withIdentity({ subject: "alice" }).query(api.screening.queries.getScreeningResultsForExport, { jobId }))!.results[0].answers;

  it("keeps a person's answer given before the model's arrives, and records the model's beside it", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      setupScreeningWorkpool(t);
      const { screeningId, jobId } = await seedJob(t, [{ key: "q0", question: "Randomized?" }]);
      await t.run((ctx) => answerPaper(ctx, screeningId, "https://openalex.org/W1", [{ question: "Randomized?", response: false }], "person", 40));
      await finish(t, jobId, { q0: true }, { q0: 0.7 }, 30);
      await t.mutation(internal.screening.drain.drainJobAnswers, { jobId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await row(t, screeningId)).map(({ answer, setBy, model }) => ({ answer, setBy, model: model && { answer: model.answer, confidence: model.confidence } }))).toEqual([
        { answer: false, setBy: "person", model: { answer: true, confidence: 0.7 } },
      ]);
      // What the job answered is what its export shows.
      expect(await exported(t, jobId)).toEqual({ q0: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("exports what the job answered after a person changes it, with a column for each question", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      setupScreeningWorkpool(t);
      // Two questions with the same words, as the dialog allows.
      const { screeningId, jobId } = await seedJob(t, [{ key: "q0", question: "Randomized?" }, { key: "q1", question: "Randomized?" }]);
      await finish(t, jobId, { q0: true, q1: true }, { q0: 0.6, q1: 0.6 }, 30);
      await t.mutation(internal.screening.drain.drainJobAnswers, { jobId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      await t.run((ctx) => answerPaper(ctx, screeningId, "https://openalex.org/W1", [{ question: "Randomized?", response: false }], "person", 50));
      expect((await row(t, screeningId))[0]).toMatchObject({ answer: false, setBy: "person" });
      expect(await exported(t, jobId)).toEqual({ q0: true, q1: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a new confidence when the model gives the same answer again", async () => {
    const t = convexTest(schema);
    const { screeningId } = await seedJob(t, [{ key: "q0", question: "Randomized?" }]);
    await t.run((ctx) => answerPaper(ctx, screeningId, "https://openalex.org/W1", [{ question: "Randomized?", response: true }], "model", 10));
    await t.run((ctx) => answerPaper(ctx, screeningId, "https://openalex.org/W1", [{ question: "Randomized?", response: true, confidence: 0.9 }], "model", 20));
    expect((await row(t, screeningId))[0].model).toEqual({ answer: true, confidence: 0.9, at: 20 });
  });
});
