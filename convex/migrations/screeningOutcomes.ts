import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { account, FAILED, standing, withDeltas } from "../screening/accounting";
import { progressOf } from "../screening/bookkeeping";

/**
 * Gives each screened paper from before outcomes were kept the outcome its job's list
 * reads it by, scored on its answers as they stand, and adds it to its job's unclear count
 * and question tallies (#421). A paper records what it has counted (`counted`), which the
 * bookkeeping worker and a changed answer set too, so each paper is counted once whichever
 * gets to it first. Safe to run again.
 *
 *   npx convex run migrations/screeningOutcomes:run '{"dryRun": true}'
 *   npx convex run migrations/screeningOutcomes:run
 *   npx convex run migrations/screeningOutcomes:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** A settled paper the bookkeeping worker counted before papers recorded what they count as. */
const waits = (result: Doc<"screeningResults">) =>
  result.counted === undefined && result.doneAt === undefined && (result.status === "completed" || result.status === "failed");

// A paper a step: it reads its job, its answers and its job's progress. A result holds its paper's abstract.
export const papers = migrations.define({
  table: "screeningResults",
  batchSize: 50,
  migrateOne: async (ctx, result) => {
    if (!waits(result)) return;
    if (result.status === "failed") return FAILED;
    const job = await ctx.db.get("screeningJobs", result.jobId);
    if (!job) return;
    const progress = await progressOf(ctx, job._id);
    const { patch, delta } = account(job, result, await standing(ctx, job, result));
    await ctx.db.patch("screeningJobProgress", progress._id, withDeltas(progress, job, [delta]));
    return patch;
  },
});

export const run = migrations.runner(internal.migrations.screeningOutcomes.papers);

/** Settled papers on one page, of jobs that still exist, that haven't recorded what they count as. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("screeningResults").paginate({ cursor, numItems: 50, maximumBytesRead: 4 * 1024 * 1024 });
    let wrong = 0;
    for (const result of page.page) if (waits(result) && (await ctx.db.get("screeningJobs", result.jobId))) wrong++;
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many settled papers haven't recorded what they count as; 0 when done. */
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
