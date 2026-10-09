import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { placeRating } from "../ratings";

/**
 * Gives every paper's place in a collection the rating it sorts by there (#655): in an
 * organization's collection its members' average of their ratings there, which none have given
 * yet, instead of the paper's rating it copied. A person's own collections keep the paper's.
 *
 *   npx convex run migrations/placeRatings:run
 *   npx convex run migrations/placeRatings:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const places = migrations.define({
  table: "libraryItemCollections",
  batchSize: 200,
  migrateOne: async (ctx, place) => {
    const item = await ctx.db.get("libraryItems", place.libraryItemId);
    // A removed paper's places go in their own batches.
    if (!item) return;
    const rating = await placeRating(ctx, place.collectionId, item);
    if (rating !== place.rating) await ctx.db.patch("libraryItemCollections", place._id, { rating });
  },
});

export const run = migrations.runner(internal.migrations.placeRatings.places);

/** Places on one page whose rating isn't the one they sort by. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("libraryItemCollections").paginate({ cursor, numItems: 200 });
    const wrong = await Promise.all(page.page.map(async (place) => {
      const item = await ctx.db.get("libraryItems", place.libraryItemId);
      return item !== null && (await placeRating(ctx, place.collectionId, item)) !== place.rating;
    }));
    return { wrong: wrong.filter(Boolean).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many places aren't in step; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.placeRatings.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) return wrong;
      cursor = page.continueCursor;
    }
  },
});
