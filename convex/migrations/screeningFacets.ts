import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { countEntries, paperEntries, recountVote, screeningCounts, voteEntries } from "../screening/facets";

/**
 * Counts the papers and votes of every screening with reviewers that predate their counts (screening/facets.ts): each
 * paper under its source, its check and its reason, each vote under its reviewer with where its paper stands, and
 * each cast vote by when. Rows written since are kept by their triggers; a row is counted once however often this runs.
 *
 *   npx convex run migrations/screeningFacets:run '{"dryRun": true}'
 *   npx convex run migrations/screeningFacets:run
 *   npx convex run migrations/screeningFacets:verify
 *
 * `verify` finds counts missing. `readVotes` takes out the stale ones a model's reading left (#1617).
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const papers = migrations.define({
  table: "screeningResults",
  batchSize: 200,
  migrateOne: async (ctx, paper) => {
    await countEntries(ctx, paperEntries(paper));
  },
});

export const votes = migrations.define({
  table: "screeningVotes",
  batchSize: 200,
  migrateOne: async (ctx, vote) => {
    await countEntries(ctx, voteEntries(vote, await ctx.db.get("screeningResults", vote.resultId)));
  },
});

/** Votes counted as waiting after a model's reading came back through the pool without the triggers (#1617): counted again as they stand. */
export const readVotes = migrations.define({
  table: "screeningVotes",
  batchSize: 200,
  migrateOne: async (ctx, vote) => {
    if (vote.status !== "waiting") await recountVote(ctx, vote, await ctx.db.get("screeningResults", vote.resultId));
  },
});

export const run = migrations.runner([internal.migrations.screeningFacets.papers, internal.migrations.screeningFacets.votes, internal.migrations.screeningFacets.readVotes]);

const tableValidator = v.union(v.literal("screeningResults"), v.literal("screeningVotes"));

/** Entries one page of `table` should have that the counts don't, and waiting entries its votes no longer waiting still have. */
export const verifyPage = internalQuery({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 100 };
    const missing = async (entries: ReturnType<typeof paperEntries>) =>
      (await screeningCounts.countBatch(ctx, entries.map(({ namespace, key, id }) => ({ namespace, bounds: { lower: { key, id, inclusive: true }, upper: { key, id, inclusive: true } } })) as never, { stale: true })).filter((count) => count !== 1).length;
    if (table === "screeningResults") {
      const page = await ctx.db.query("screeningResults").paginate(opts);
      return { missing: await missing(page.page.flatMap(paperEntries)), isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query("screeningVotes").paginate(opts);
    const entries = (await Promise.all(page.page.map(async (vote) => voteEntries(vote, await ctx.db.get("screeningResults", vote.resultId))))).flat();
    const stale = page.page.filter((vote) => vote.status !== "waiting").flatMap((vote) => ["include", "maybe", "exclude", "conflict", "waiting"].map((result) => ({ namespace: `${vote.reviewerId}`, key: `waiting|${result}`, id: vote._id })));
    const left = (await screeningCounts.countBatch(ctx, stale.map(({ namespace, key, id }) => ({ namespace, bounds: { lower: { key, id, inclusive: true }, upper: { key, id, inclusive: true } } })) as never, { stale: true })).filter((count) => count > 0).length;
    return { missing: (await missing(entries)) + left, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many entries `verifyPage` finds missing or stale across both tables; 0 when the counts are right. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (const table of ["screeningResults", "screeningVotes"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.screeningFacets.verifyPage, { table, cursor });
        missing += page.missing;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return missing;
  },
});
