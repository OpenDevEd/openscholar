// Screen all saved answers on its results before #334; the migration moves every one into the
// job's screening once, and `verify` says when none is left.
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { insertMany } from "../lib/maxSize.test-support";

const questions = [{ key: "q0", question: "Randomized?" }, { key: "q1", question: "Primary school?" }];
const scoringConfig = { rules: [], starThresholds: [] };

const seedUser = (t: ReturnType<typeof convexTest>) =>
  t.run((ctx) => ctx.db.insert("users", { libraryItemCount: 0, clerkId: "alice", email: "a@test", state: "active", createdAt: 1, updatedAt: 1 }));
const insertJob = (ctx: MutationCtx, userId: Id<"users">, screeningId?: Id<"screenings">) =>
  ctx.db.insert("screeningJobs", { userId, status: "completed", totalPapers: 2, questions, scoringConfig, ...(screeningId ? { screeningId } : {}), createdAt: 5, updatedAt: 5 });

const result = (jobId: Id<"screeningJobs">, paper: string, answers?: Record<string, boolean | null>) => ({
  jobId, openalexId: `https://openalex.org/${paper}`, title: paper, status: answers ? ("completed" as const) : ("failed" as const),
  ...(answers ? { answers, score: 1, stars: 1, qualified: true, aiMetadata: { confidence: 0.7 } } : {}), createdAt: 10, completedAt: 20,
});

describe("moveScreeningJobAnswers", () => {
  it("moves every saved answer into its job's screening once, keeping the overall confidence on the result", async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest(schema);
      const userId = await seedUser(t);
      const { legacy, started } = await t.run(async (ctx) => {
        const legacy = await insertJob(ctx, userId);
        await ctx.db.insert("screeningResults", result(legacy, "W1", { q0: true, q1: null }));
        await ctx.db.insert("screeningResults", result(legacy, "W2", { q0: false, q1: false }));
        await ctx.db.insert("screeningResults", result(legacy, "W3"));
        // A job that was running when #334 shipped: its later answers already went to a screening.
        const screeningId = await ctx.db.insert("screenings", { userId, version: 1, createdAt: 5 });
        await ctx.db.insert("screeningAnswers", { screeningId, paperId: "https://openalex.org/W5", answers: [
          { question: "Randomized?", answer: true, setBy: "model", updatedAt: 30, model: { answer: true, confidence: 0.9, at: 30 } },
          { question: "Primary school?", answer: true, setBy: "model", updatedAt: 30, model: { answer: true, confidence: 0.8, at: 30 } },
        ] });
        const started = await insertJob(ctx, userId, screeningId);
        await ctx.db.insert("screeningResults", result(started, "W4", { q0: null, q1: true }));
        await ctx.db.insert("screeningResults", { ...result(started, "W5", { q0: true, q1: true }), answers: undefined });
        return { legacy, started };
      });
      // Each of the three results not moved yet still holds its answers, and has none in a screening.
      expect(await t.action(internal.migrations.moveScreeningJobAnswers.verify, {})).toHaveLength(6);

      await t.mutation(internal.migrations.moveScreeningJobAnswers.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await t.action(internal.migrations.moveScreeningJobAnswers.verify, {})).toEqual([]);
      const answers = async (jobId: Id<"screeningJobs">) => t.run(async (ctx) => {
        const screeningId = (await ctx.db.get("screeningJobs", jobId))!.screeningId!;
        const rows = await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId)).collect();
        return Object.fromEntries(rows.map((row) => [row.paperId.slice(21), row.answers.map(({ question, answer, setBy, model }) => [question, answer, setBy, model?.confidence ?? "none"])]));
      });
      expect(await answers(legacy)).toEqual({
        W1: [["Randomized?", true, "model", "none"], ["Primary school?", null, "model", "none"]],
        W2: [["Randomized?", false, "model", "none"], ["Primary school?", false, "model", "none"]],
      });
      expect(await answers(started)).toEqual({
        W4: [["Randomized?", null, "model", "none"], ["Primary school?", true, "model", "none"]],
        W5: [["Randomized?", true, "model", 0.9], ["Primary school?", true, "model", 0.8]],
      });
      const kept = await t.run((ctx) => ctx.db.query("screeningResults").collect());
      expect(kept.filter((row) => row.status === "completed").map((row) => row.aiMetadata?.confidence)).toEqual([0.7, 0.7, 0.7, 0.7]);
    } finally {
      vi.useRealTimers();
    }
  });

  it(`moves a job of ${MAX_SCREENING_PAPERS_PER_JOB} answered papers within Convex's limits`, async () => {
    vi.useFakeTimers();
    try {
      const t = convexTest({ schema, transactionLimits: true });
      const userId = await seedUser(t);
      const jobId = await t.run((ctx) => insertJob(ctx, userId));
      await insertMany(t, "screeningResults", Array.from({ length: MAX_SCREENING_PAPERS_PER_JOB }, (_, i) => ({
        ...result(jobId, `W${i}`, { q0: i % 2 === 0, q1: null }), abstract: "An abstract of an ordinary length. ".repeat(40),
      })), 250);
      await t.mutation(internal.migrations.moveScreeningJobAnswers.run, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await t.action(internal.migrations.moveScreeningJobAnswers.verify, {})).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  }, 300_000);
});
