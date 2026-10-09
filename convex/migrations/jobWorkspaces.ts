import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";
import { internalAction, internalQuery, type MutationCtx } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { ensureWorkspace } from "../workspaces/create";

/**
 * Puts every screening and extraction job from before workspaces (#650, slice 4) in its
 * person's own workspace, as theirs, and with them the screenings their answers go to, the
 * screening slots, the extraction queue and the record counts. A screening of a search is in the
 * search's workspace, and a queued paper in its job's. New rows carry their workspace from the
 * start, and running this again changes nothing. Reads move off `userId` once `verify` says 0.
 *
 *   npx convex run migrations/jobWorkspaces:run
 *   npx convex run migrations/jobWorkspaces:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

const own = (ctx: MutationCtx, userId: Id<"users">) => ensureWorkspace(ctx, { kind: "personal", userId });

// A job holds its questions and the search it read, and its triggers read it again on a patch.
export const screeningJobs = migrations.define({
  table: "screeningJobs",
  batchSize: 25,
  migrateOne: async (ctx, job) => (job.workspaceId ? undefined : { workspaceId: await own(ctx, job.userId), createdBy: job.userId }),
});

export const extractionJobs = migrations.define({
  table: "extractionJobs",
  batchSize: 25,
  migrateOne: async (ctx, job) => (job.workspaceId ? undefined : { workspaceId: await own(ctx, job.userId), createdBy: job.userId }),
});

export const screenings = migrations.define({
  table: "screenings",
  migrateOne: async (ctx, screening) => {
    if (screening.workspaceId) return;
    const search = screening.searchId ? await ctx.db.get("searches", screening.searchId) : null;
    return { workspaceId: search?.workspaceId ?? (await own(ctx, screening.userId)) };
  },
});

export const screeningSlots = migrations.define({
  table: "screeningSlots",
  migrateOne: async (ctx, slots) => (slots.workspaceId ? undefined : { workspaceId: await own(ctx, slots.userId) }),
});

export const extractionQueue = migrations.define({
  table: "extractionPaperQueue",
  batchSize: 200,
  migrateOne: async (ctx, row) => {
    if (row.workspaceId) return;
    const job = await ctx.db.get("extractionJobs", row.jobId);
    return { workspaceId: job?.workspaceId ?? (await own(ctx, row.userId)) };
  },
});

export const recordCounts = migrations.define({
  table: "recordCounts",
  migrateOne: async (ctx, row) => (row.workspaceId ? undefined : { workspaceId: await own(ctx, row.userId) }),
});

// Jobs first, so a queued paper takes its job's workspace.
export const run = migrations.runner([
  internal.migrations.jobWorkspaces.screeningJobs,
  internal.migrations.jobWorkspaces.extractionJobs,
  internal.migrations.jobWorkspaces.screenings,
  internal.migrations.jobWorkspaces.screeningSlots,
  internal.migrations.jobWorkspaces.extractionQueue,
  internal.migrations.jobWorkspaces.recordCounts,
]);

const TABLES = ["screeningJobs", "extractionJobs", "screenings", "screeningSlots", "extractionPaperQueue", "recordCounts"] as const;
const tableValidator = v.union(v.literal("screeningJobs"), v.literal("extractionJobs"), v.literal("screenings"), v.literal("screeningSlots"), v.literal("extractionPaperQueue"), v.literal("recordCounts"));

/** Rows on one page of `table` with no workspace yet, or a job with no maker. */
export const verifyPage = internalQuery({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 200, maximumBytesRead: 4 * 1024 * 1024 };
    if (table === "screeningJobs" || table === "extractionJobs") {
      const page = await ctx.db.query(table).paginate(opts);
      return { missing: page.page.filter((job) => !job.workspaceId || !job.createdBy).length, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query(table).paginate(opts);
    return { missing: page.page.filter((row) => !row.workspaceId).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many job rows have no workspace; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of TABLES) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.jobWorkspaces.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
