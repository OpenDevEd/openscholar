import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Doc } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { countBookkept, progressRow } from "../screening/bookkeeping";

/**
 * Gives every Screen all job counted before the bookkeeping worker (#399) its progress row,
 * counted from its results. Papers the worker hasn't handled yet are left to it. A job the
 * worker already touched has a row and is skipped. One job per transaction, safe to run again.
 *
 *   npx convex run migrations/moveScreeningJobProgress:run '{"dryRun": true}'
 *   npx convex run migrations/moveScreeningJobProgress:run
 *   npx convex run migrations/moveScreeningJobProgress:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const moveProgress = migrations.define({
  table: "screeningJobs",
  batchSize: 1,
  migrateOne: async (ctx, job) => {
    if (await progressRow(ctx, job._id)) return;
    await ctx.db.insert("screeningJobProgress", { jobId: job._id, ...(await countBookkept(ctx, job._id)) });
  },
});

export const run = migrations.runner(internal.migrations.moveScreeningJobProgress.moveProgress);

/** One job's check: it has a progress row, and the row matches its bookkept papers. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ problems: v.array(v.string()), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("screeningJobs").paginate({ cursor, numItems: 1 });
    const problems: string[] = [];
    for (const job of page.page as Doc<"screeningJobs">[]) {
      const row = await progressRow(ctx, job._id);
      if (!row) {
        problems.push(`${job._id}: no progress row`);
        continue;
      }
      const expected = await countBookkept(ctx, job._id);
      const kept = { completed: row.completed, skipped: row.skipped, failed: row.failed, qualified: row.qualified };
      if (JSON.stringify(kept) !== JSON.stringify(expected)) problems.push(`${job._id}: counted ${JSON.stringify(kept)}, results say ${JSON.stringify(expected)}`);
    }
    return { problems, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many jobs have no progress row or count wrong, with the first few; `wrong` is 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.object({ wrong: v.number(), sample: v.array(v.string()) }),
  handler: async (ctx): Promise<{ wrong: number; sample: string[] }> => {
    let wrong = 0;
    const sample: string[] = [];
    for (let cursor: string | null = null; ;) {
      const page: { problems: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.moveScreeningJobProgress.verifyPage, { cursor });
      wrong += page.problems.length;
      sample.push(...page.problems.slice(0, 20 - sample.length));
      if (page.isDone) return { wrong, sample };
      cursor = page.continueCursor;
    }
  },
});
