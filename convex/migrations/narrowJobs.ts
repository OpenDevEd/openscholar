import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import schema from "../schema";

/**
 * Clears the person a screening or extraction job belonged to before workspaces (#650, slice 8):
 * jobs, their queued papers and the screening slots are their workspace's, and a job keeps who
 * started it as `createdBy`. A paper still waiting under its person's slots waits under its
 * workspace's alone. Nothing reads either field any more; once this reports 0 on every
 * deployment, they go from the schema. Running it again changes nothing.
 *
 *   npx convex run migrations/narrowJobs:run
 *   npx convex run migrations/narrowJobs:verify
 */
const migrations = new Migrations<DataModel, typeof schema>(components.migrations, { internalMutation, schema });

const cleared = (row: { userId?: unknown }) => (row.userId === undefined ? undefined : { userId: undefined });
// An ID is a string and sorts after a missing field, so from "" on an index is every row that names one.
const NO_ID = "" as Id<"users">;

// A job holds its questions and the search it read, near a document's 1 MiB: five at a time.
export const screeningJobs = migrations.define({ table: "screeningJobs", batchSize: 5, migrateOne: (_ctx, row) => cleared(row) });
export const extractionJobs = migrations.define({ table: "extractionJobs", batchSize: 5, migrateOne: (_ctx, row) => cleared(row) });
export const queue = migrations.define({ table: "extractionPaperQueue", batchSize: 200, migrateOne: (_ctx, row) => cleared(row) });
export const slots = migrations.define({ table: "screeningSlots", migrateOne: (_ctx, row) => cleared(row) });
// Only the papers that still name a person, by the index on it, of a table too big to read whole.
// A paper keeps its abstract, with no byte cap of its own: ten at a time.
export const waiting = migrations.define({
  table: "screeningResults",
  batchSize: 10,
  customRange: (q) => q.withIndex("by_waitingUser_and_waitingSince", (r) => r.gte("waitingUser", NO_ID)),
  migrateOne: () => ({ waitingUser: undefined }),
});

export const run = migrations.runner([
  internal.migrations.narrowJobs.screeningJobs,
  internal.migrations.narrowJobs.extractionJobs,
  internal.migrations.narrowJobs.queue,
  internal.migrations.narrowJobs.slots,
  internal.migrations.narrowJobs.waiting,
]);

const TABLES = ["screeningJobs", "extractionJobs", "extractionPaperQueue", "screeningSlots"] as const;

/** Rows on one page of `table` that still name a person. */
export const verifyPage = internalQuery({
  args: { table: v.union(...TABLES.map((table) => v.literal(table))), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 200, maximumBytesRead: 4 * 1024 * 1024 });
    return { missing: page.page.filter((row) => row.userId !== undefined).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Papers on one page still waiting under a person's slots. */
export const waitingPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("screeningResults").withIndex("by_waitingUser_and_waitingSince", (q) => q.gte("waitingUser", NO_ID)).paginate({ cursor, numItems: 100, maximumBytesRead: 4 * 1024 * 1024 });
    return { missing: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many job rows still name a person; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (let cursor: string | null = null; ;) {
      const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.narrowJobs.waitingPage, { cursor });
      missing += page.missing;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    for (const table of TABLES) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.narrowJobs.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
