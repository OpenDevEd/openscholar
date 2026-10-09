import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { personalRatingRow, setPersonalRating } from "../ratings";

/**
 * Copies every rating from before the ratings table (#655) into it as the person's own. New and
 * changed ratings are written to both, and running this again changes nothing. Reads move to
 * `ratings` once `verify` says 0 on every deployment.
 *
 *   npx convex run migrations/copyRatings:run
 *   npx convex run migrations/copyRatings:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const ratings = migrations.define({
  table: "paperRatings",
  batchSize: 200,
  migrateOne: async (ctx, row) => {
    await setPersonalRating(ctx, row.userId, row.data.paperId, row.data.rating);
  },
});

export const run = migrations.runner(internal.migrations.copyRatings.ratings);

/** Ratings on one page that the ratings table doesn't have as they are. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ missing: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("paperRatings").paginate({ cursor, numItems: 200 });
    const copies = await Promise.all(page.page.map((row) => personalRatingRow(ctx, row.userId, row.data.paperId)));
    return { missing: page.page.filter((row, at) => copies[at]?.rating !== row.data.rating).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many ratings aren't copied yet; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let missing = 0;
    for (let cursor: string | null = null; ;) {
      const page: { missing: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.copyRatings.verifyPage, { cursor });
      missing += page.missing;
      if (page.isDone) return missing;
      cursor = page.continueCursor;
    }
  },
});
