import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { placeRated } from "../ratings";

/**
 * Gives every paper's place in a collection the rating it sorts by there (#655): in an
 * organization's collection its members' average of their ratings there, and how many gave it,
 * instead of the paper's rating it copied. A person's own collections keep the paper's. Run
 * again with `reset` once places kept the count too:
 *
 *   npx convex run migrations/placeRatings:run '{"reset":true}'
 *   npx convex run migrations/placeRatings:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** What a place should keep, or null when it keeps it already, or its paper is gone (a removed paper's places go in their own batches). */
async function due(ctx: Pick<QueryCtx, "db">, place: Doc<"libraryItemCollections">) {
  const item = await ctx.db.get("libraryItems", place.libraryItemId);
  if (!item) return null;
  const { rating, count } = await placeRated(ctx, place.collectionId, item);
  return rating === place.rating && count === place.ratingCount ? null : { rating, ratingCount: count };
}

export const places = migrations.define({
  table: "libraryItemCollections",
  batchSize: 200,
  migrateOne: async (ctx, place) => {
    const next = await due(ctx, place);
    if (next) await ctx.db.patch("libraryItemCollections", place._id, next);
  },
});

export const run = migrations.runner(internal.migrations.placeRatings.places);

/** Places on one page whose rating or count isn't the one they should keep. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("libraryItemCollections").paginate({ cursor, numItems: 200 });
    const wrong = await Promise.all(page.page.map(async (place) => (await due(ctx, place)) !== null));
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
