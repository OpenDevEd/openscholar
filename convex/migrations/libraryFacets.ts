import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { countedItem, countedMembership, countRow, facetsMatch, facetsOf, uncountedFacets } from "../library/facets";

/**
 * Readies library views for any size (#633): every membership gets its paper's sort and
 * filter fields, and every paper and membership is counted by them (library/facets.ts).
 * Rows written since are kept by their triggers, and a row is counted once however often
 * this runs.
 *
 *   npx convex run migrations/libraryFacets:run '{"dryRun": true}'
 *   npx convex run migrations/libraryFacets:run
 *   npx convex run migrations/libraryFacets:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const memberships = migrations.define({
  table: "libraryItemCollections",
  batchSize: 200,
  migrateOne: async (ctx, membership) => {
    const item = await ctx.db.get("libraryItems", membership.libraryItemId);
    // A removed paper's places go in their own batches.
    if (!item) return;
    // Given its fields, the trigger counts it.
    if (!facetsMatch(membership, item)) return facetsOf(item);
    await countRow(ctx, membership._id, countedMembership(membership));
  },
});

export const items = migrations.define({
  table: "libraryItems",
  batchSize: 200,
  migrateOne: async (ctx, item) => {
    await countRow(ctx, item._id, countedItem(item));
  },
});

export const run = migrations.runner([internal.migrations.libraryFacets.memberships, internal.migrations.libraryFacets.items]);

const tableValidator = v.union(v.literal("libraryItemCollections"), v.literal("libraryItems"));

/** Rows on one page of `table` the backfill hasn't reached: a membership without its paper's fields, or a row not counted. */
export const verifyPage = internalQuery({
  args: { table: tableValidator, cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { table, cursor }) => {
    const opts = { cursor, numItems: 100 };
    if (table === "libraryItems") {
      const page = await ctx.db.query("libraryItems").paginate(opts);
      return { wrong: await uncountedFacets(ctx, page.page.map((item) => ({ id: item._id, row: countedItem(item) }))), isDone: page.isDone, continueCursor: page.continueCursor };
    }
    const page = await ctx.db.query("libraryItemCollections").paginate(opts);
    const live = (await Promise.all(page.page.map(async (membership) => ({ membership, item: await ctx.db.get("libraryItems", membership.libraryItemId) })))).filter(({ item }) => item !== null);
    const unfilled = live.filter(({ membership, item }) => !facetsMatch(membership, item!)).length;
    const uncounted = await uncountedFacets(ctx, live.map(({ membership }) => ({ id: membership._id, row: countedMembership(membership) })));
    return { wrong: unfilled + uncounted, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many rows `verifyPage` finds wrong across the tables; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (const table of ["libraryItemCollections", "libraryItems"] as const) {
      for (let cursor: string | null = null; ;) {
        const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.libraryFacets.verifyPage, { table, cursor });
        wrong += page.wrong;
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    return wrong;
  },
});
