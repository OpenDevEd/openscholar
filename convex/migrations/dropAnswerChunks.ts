import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Removes what is left of the chunks screening answers were once saved in (#421): the chunk
 * lists on searches and revisions, and the chunk rows. Their answers moved to answer rows and
 * their history in #334, verified on every deployment that had chunks before this was
 * written. The schema drops the field and the table once this has run. Safe to run again.
 *
 *   npx convex run migrations/dropAnswerChunks:run '{"dryRun": true}'
 *   npx convex run migrations/dropAnswerChunks:run
 *   npx convex run migrations/dropAnswerChunks:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

// Batches small enough for the largest records: a search can be up to 1 MiB.
export const searches = migrations.define({
  table: "searches",
  batchSize: 5,
  migrateOne: (_ctx, search) => (search.responseChunks === undefined ? undefined : { responseChunks: undefined }),
});

export const revisions = migrations.define({
  table: "searchRevisions",
  batchSize: 5,
  migrateOne: (_ctx, revision) => (revision.responseChunks === undefined ? undefined : { responseChunks: undefined }),
});

export const chunks = migrations.define({
  table: "researchResponseChunks",
  batchSize: 5,
  migrateOne: async (ctx, chunk) => {
    await ctx.db.delete("researchResponseChunks", chunk._id);
  },
});

export const run = migrations.runner([internal.migrations.dropAnswerChunks.searches, internal.migrations.dropAnswerChunks.revisions, internal.migrations.dropAnswerChunks.chunks]);

const tableValidator = v.union(v.literal("searches"), v.literal("searchRevisions"), v.literal("researchResponseChunks"));

/** Rows on one page of `table` that still hold chunks, or are one. */
export const verifyPage = internalQuery({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const read = { cursor, numItems: 50, maximumBytesRead: 4 * 1024 * 1024 };
    if (table === "researchResponseChunks") {
      const page = await ctx.db.query("researchResponseChunks").paginate(read);
      return { wrong: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = table === "searches" ? await ctx.db.query("searches").paginate(read) : await ctx.db.query("searchRevisions").paginate(read);
    return { wrong: page.page.filter((row) => row.responseChunks !== undefined).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many chunk lists and chunk rows are left; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (const table of ["searches", "searchRevisions", "researchResponseChunks"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.dropAnswerChunks.verifyPage, { table, cursor });
        wrong += page.wrong;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return wrong;
  },
});
