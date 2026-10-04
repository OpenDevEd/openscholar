import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Clears `screeningJobs.resultCounts`, the mark the sharded counters left on jobs they
 * counted (#403). Nothing reads it; once no job holds it the field leaves the schema, and
 * this file with it. Safe to run again.
 *
 *   npx convex run migrations/dropScreeningResultCounts:run
 *   npx convex run migrations/dropScreeningResultCounts:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const clear = migrations.define({
  table: "screeningJobs",
  migrateOne: (_ctx, job) => (job.resultCounts === undefined ? undefined : { resultCounts: undefined }),
});

export const run = migrations.runner(internal.migrations.dropScreeningResultCounts.clear);

/** Jobs on one page that still hold the mark. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("screeningJobs").paginate({ cursor, numItems: 100, maximumBytesRead: 4 * 1024 * 1024 });
    return { wrong: page.page.filter((job) => job.resultCounts !== undefined).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many jobs still hold the mark; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.dropScreeningResultCounts.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return wrong;
  },
});
