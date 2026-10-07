import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { answerEntries, countEntries, extractionCounts, paperEntries } from "../extraction/facets";

/**
 * Readies extraction jobs for any size (#634): counts every processable paper by confidence
 * and status, and every answer row by its answer (extraction/facets.ts), and tallies each
 * answer row once in its question's tallies (extraction/tallies.ts) by marking it, which
 * its trigger counts. Rows written since are kept by their triggers; a row is counted once
 * however often this runs.
 *
 *   npx convex run migrations/extractionFacets:run '{"dryRun": true}'
 *   npx convex run migrations/extractionFacets:run
 *   npx convex run migrations/extractionFacets:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const papers = migrations.define({
  table: "extractionPapers",
  batchSize: 200,
  migrateOne: async (ctx, paper) => {
    await countEntries(ctx, paperEntries(paper));
  },
});

export const answerRows = migrations.define({
  table: "extractionAnswerRows",
  batchSize: 200,
  migrateOne: async (ctx, row) => {
    await countEntries(ctx, answerEntries(row));
    // Marked, the trigger counts it in the tallies.
    if (!row.tallied) return { tallied: true as const };
  },
});

export const run = migrations.runner([internal.migrations.extractionFacets.papers, internal.migrations.extractionFacets.answerRows]);

const tableValidator = v.union(v.literal("extractionPapers"), v.literal("extractionAnswerRows"));

/** Rows on one page of `table` the backfill hasn't reached: entries the counts are missing, or an answer row not tallied. */
export const verifyPage = internalQuery({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 100 };
    const missing = async (entries: ReturnType<typeof paperEntries>) =>
      (await extractionCounts.countBatch(ctx, entries.map(({ namespace, key, id }) => ({ namespace, bounds: { lower: { key, id, inclusive: true }, upper: { key, id, inclusive: true } } })) as never, { stale: true })).filter((count) => count !== 1).length;
    if (table === "extractionPapers") {
      const page = await ctx.db.query("extractionPapers").paginate(opts);
      return { wrong: await missing(page.page.flatMap(paperEntries)), isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query("extractionAnswerRows").paginate(opts);
    const untallied = page.page.filter((row) => !row.tallied).length;
    return { wrong: untallied + (await missing(page.page.flatMap(answerEntries))), isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many rows `verifyPage` finds wrong across both tables; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (const table of ["extractionPapers", "extractionAnswerRows"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.extractionFacets.verifyPage, { table, cursor });
        wrong += page.wrong;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return wrong;
  },
});
