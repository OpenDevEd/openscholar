import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { progressRow } from "../screening/bookkeeping";
import { jobAnswers } from "../screening/queries";
import { outcomeOf, tallied } from "../screening/scoring";

/**
 * Gives each screened paper from before outcomes were kept the outcome its job's list
 * reads it by, worked out from what the job answered, and adds it to its job's unclear
 * count and question tallies (#421). A paper settled since already has its outcome and was
 * counted then, so each paper is counted once. Safe to run again.
 *
 *   npx convex run migrations/screeningOutcomes:run '{"dryRun": true}'
 *   npx convex run migrations/screeningOutcomes:run
 *   npx convex run migrations/screeningOutcomes:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** A settled paper the bookkeeping worker has counted, still without its outcome. */
const waits = (result: Doc<"screeningResults">) =>
  result.outcome === undefined && result.doneAt === undefined && (result.status === "completed" || result.status === "failed");

// A paper a step: it reads its job, its answers and its job's progress. A result holds its paper's abstract.
export const papers = migrations.define({
  table: "screeningResults",
  batchSize: 50,
  migrateOne: async (ctx, result) => {
    if (!waits(result)) return;
    if (result.status === "failed") return { outcome: "failed" as const };
    const job = await ctx.db.get("screeningJobs", result.jobId);
    const answers = job && (await jobAnswers(ctx, job, result));
    if (!job || !answers) return;
    const outcome = outcomeOf(answers, job.scoringConfig);
    const progress = await progressRow(ctx, job._id);
    if (progress) {
      await ctx.db.patch("screeningJobProgress", progress._id, {
        unclear: (progress.unclear ?? 0) + Number(outcome === "unclear"),
        tallies: tallied(progress.tallies, job.questions.map((question) => question.key), answers, 1),
      });
    }
    return { outcome };
  },
});

export const run = migrations.runner(internal.migrations.screeningOutcomes.papers);

/** Settled papers on one page still without an outcome that have answers to work one out from. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("screeningResults").paginate({ cursor, numItems: 50, maximumBytesRead: 4 * 1024 * 1024 });
    let wrong = 0;
    for (const result of page.page) {
      if (!waits(result)) continue;
      const job = await ctx.db.get("screeningJobs", result.jobId);
      if (result.status === "failed" || (job && (await jobAnswers(ctx, job, result)))) wrong++;
    }
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many settled papers still lack their outcome; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.screeningOutcomes.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return wrong;
  },
});
