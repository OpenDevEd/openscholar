import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { searchCountRow, startSearchCount } from "../research/searchCounts";

/**
 * Readies saved searches to list a page at a time (#420): each person who has any gets the
 * count row the pages total from, counted a page at a time (research/searchCounts.ts).
 * Someone who saves or deletes a search first is counted then. Safe to run again.
 *
 *   npx convex run migrations/pagedSearches:run '{"dryRun": true}'
 *   npx convex run migrations/pagedSearches:run
 *   npx convex run migrations/pagedSearches:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const prepare = migrations.define({
  table: "searches",
  batchSize: 50,
  migrateOne: async (ctx, search) => {
    await startSearchCount(ctx, search.userId);
  },
});

export const run = migrations.runner(internal.migrations.pagedSearches.prepare);

/** Owners on one page of searches with no count, or one still being taken. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("searches").paginate({ cursor, numItems: 20 });
    let wrong = 0;
    for (const userId of new Set(page.page.map((search) => search.userId))) {
      const row = await searchCountRow(ctx, userId);
      if (!row || row.countedTo !== undefined) wrong++;
    }
    return { wrong, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many problems `verifyPage` finds across every search; 0 once every count is taken. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.pagedSearches.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) return wrong;
      cursor = page.continueCursor;
    }
  },
});
