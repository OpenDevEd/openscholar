import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { personalRatingRow, rateItem, setPersonalRating, workspaceRating } from "../ratings";

/**
 * A saved paper's rating becomes its people's average of their own ratings (#655). A rating a
 * paper had only in the library, which the person never gave on a search card, becomes their
 * own: the workspace's owner's, or in an organization the person who saved it. Where they have
 * one already, theirs stands, and the paper takes the average. Running it again changes nothing.
 *
 *   npx convex run migrations/adoptLibraryRatings:run
 *   npx convex run migrations/adoptLibraryRatings:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

export const items = migrations.define({
  table: "libraryItems",
  batchSize: 100,
  migrateOne: async (ctx, item) => {
    const workspace = await ctx.db.get("workspaces", item.workspaceId);
    const rater = workspace?.kind === "personal" ? workspace.userId : item.createdBy;
    // Setting it brings this paper, and the person's other copies of it, in step.
    if (item.rating !== undefined && rater && !(await personalRatingRow(ctx, rater, item.openalexId))) await setPersonalRating(ctx, rater, item.openalexId, item.rating);
    else await rateItem(ctx, item);
  },
});

export const run = migrations.runner(internal.migrations.adoptLibraryRatings.items);

/** Saved papers on one page whose rating isn't their people's average. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("libraryItems").paginate({ cursor, numItems: 100 });
    const ratings = await Promise.all(page.page.map((item) => workspaceRating(ctx, item.workspaceId, item.openalexId)));
    return { wrong: page.page.filter((item, at) => item.rating !== ratings[at]).length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** How many saved papers aren't in step; 0 when done. */
export const verify = internalAction({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    let wrong = 0;
    for (let cursor: string | null = null; ;) {
      const page: { wrong: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.migrations.adoptLibraryRatings.verifyPage, { cursor });
      wrong += page.wrong;
      if (page.isDone) return wrong;
      cursor = page.continueCursor;
    }
  },
});
