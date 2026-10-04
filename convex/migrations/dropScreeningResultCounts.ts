import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalQuery } from "../_generated/server";
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

/** How many of the oldest 1,000 jobs still hold the mark; 0 when done. Jobs made since never get it. */
export const verify = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => (await ctx.db.query("screeningJobs").take(1_000)).filter((job) => job.resultCounts !== undefined).length,
});
