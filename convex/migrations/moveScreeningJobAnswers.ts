import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { MAX_SCREENING_PAPERS_PER_JOB } from "../lib/queryBounds";
import { moveResultAnswers } from "../screening/drain";

/**
 * Moves the answers Screen all saved on each result before #334 into the job's screening,
 * where the results page and the assistant read them, and clears them from the result. A
 * job gets a screening of its own when it has none. The overall confidence a result saved
 * stays on it; no per-question confidence is made up. A hundred results per transaction,
 * safe to run again.
 *
 *   npx convex run migrations/moveScreeningJobAnswers:run '{"dryRun": true}'
 *   npx convex run migrations/moveScreeningJobAnswers:run
 *   npx convex run migrations/moveScreeningJobAnswers:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// About five index reads a result, so a batch stays well inside a transaction's 4,096.
export const moveResults = migrations.define({
  table: "screeningResults",
  batchSize: 100,
  migrateOne: async (ctx, result) => {
    await moveResultAnswers(ctx, result);
  },
});

export const run = migrations.runner(internal.migrations.moveScreeningJobAnswers.moveResults);

/**
 * One job's check for `verify`: no result still holds answers, and every completed result
 * has its answers in the job's screening, one for each of the job's questions.
 */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ problems: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("screeningJobs").paginate({ cursor, numItems: 1 });
    const problems: string[] = [];
    for (const job of page.page) {
      const rows = await ctx.db.query("screeningResults").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(MAX_SCREENING_PAPERS_PER_JOB);
      for (const result of rows) {
        if (result.answers) problems.push(`${result._id}: still holds its answers`);
        if (result.status !== "completed") continue;
        const screeningId = job.screeningId;
        const row = screeningId
          ? await ctx.db.query("screeningAnswers").withIndex("by_screening_and_paper", (q) => q.eq("screeningId", screeningId).eq("paperId", result.openalexId)).unique()
          : null;
        const answered = new Set(row?.answers.map((answer) => answer.question));
        const missing = job.questions.filter((q) => !answered.has(q.question));
        if (missing.length) problems.push(`${result._id}: no answer in job ${job._id}'s screening to ${missing.map((q) => q.key).join(", ")}`);
      }
    }
    return { problems, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Results whose answers haven't moved, or are missing from their screening; empty when done. */
export const verify = internalAction({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx): Promise<string[]> => {
    const problems: string[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { problems: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.moveScreeningJobAnswers.verifyPage, { cursor });
      problems.push(...page.problems);
      if (page.isDone) return problems;
      cursor = page.continueCursor;
    }
  },
});
