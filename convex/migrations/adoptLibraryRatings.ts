import { Migrations } from "@convex-dev/migrations";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import type { DataModel } from "../_generated/dataModel";
import { internalAction, internalQuery } from "../_generated/server";
import { internalMutation } from "../lib/functions";
import { personalRatingRow, rateItem, ratedPaper, workspaceRating } from "../ratings";

/**
 * A saved paper's rating becomes its people's average of their own ratings (#655). First, a
 * rating a paper had only in the library, which its people's ratings don't account for, becomes
 * its rater's own where they have none: the workspace owner's, or in an organization whoever
 * saved it. Nothing is re-rated in that pass, so each paper's rating is read as it was. Then every
 * paper takes its average. Run again, the first pass finds every rating accounted for.
 *
 *   npx convex run migrations/adoptLibraryRatings:run
 *   npx convex run migrations/adoptLibraryRatings:verify
 */
const migrations = new Migrations<DataModel>(components.migrations, { internalMutation });

/** Ten papers of Convex's largest document size stay inside a mutation's 16 MiB of reads. */
const BATCH = 10;

export const adopt = migrations.define({
  table: "libraryItems",
  batchSize: BATCH,
  migrateOne: async (ctx, item) => {
    const { rating } = item;
    // An average, a rating out of range, or one its people's ratings make already, is no one's own.
    if (rating === undefined || !Number.isInteger(rating) || rating < 0 || rating > 5) return;
    if (rating === (await workspaceRating(ctx, item.workspaceId, item.openalexId))) return;
    const workspace = await ctx.db.get("workspaces", item.workspaceId);
    const rater = workspace?.kind === "personal" ? workspace.userId : item.createdBy;
    if (rater && !(await personalRatingRow(ctx, rater, item.openalexId))) await ctx.db.insert("ratings", { userId: rater, paperId: ratedPaper(item.openalexId), rating });
  },
});

export const rerate = migrations.define({
  table: "libraryItems",
  batchSize: BATCH,
  migrateOne: async (ctx, item) => {
    await rateItem(ctx, item);
  },
});

export const run = migrations.runner([internal.migrations.adoptLibraryRatings.adopt, internal.migrations.adoptLibraryRatings.rerate]);

/** Saved papers on one page whose rating isn't their people's average. */
export const verifyPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({ wrong: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("libraryItems").paginate({ cursor, numItems: 100, maximumBytesRead: 8 * 1024 * 1024 });
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
