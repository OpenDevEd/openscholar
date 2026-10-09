import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";

/**
 * Empties `paperRatings`, whose ratings the ratings table has had since migrations/copyRatings
 * (#655), so the table can leave the schema once `verify` says 0 on every deployment.
 *
 *   npx convex run migrations/clearPaperRatings:run
 *   npx convex run migrations/clearPaperRatings:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const clear = migrations.define({
  table: "paperRatings",
  batchSize: 200,
  migrateOne: async (ctx, row) => {
    await ctx.db.delete("paperRatings", row._id);
  },
});

export const run = migrations.runner(internal.migrations.clearPaperRatings.clear);

/** The rows on one page. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ left: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("paperRatings").paginate({ cursor, numItems: 200 });
    return { left: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many rows are left; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let left = 0;
    for (let cursor: string | null = null; ;) {
      const page: { left: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.clearPaperRatings.verifyPage, { cursor });
      left += page.left;
      if (page.isDone) return left;
      cursor = page.continueCursor;
    }
  },
});
