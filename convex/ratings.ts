import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { workUrl } from "../lib/openalex/work-id";

/** The ID a rating is kept under: a paper's whole OpenAlex address, however it was given, so every rating of it meets. */
export const ratedPaper = (paperId: string) => workUrl(paperId) ?? paperId;

/** A person's own rating of a paper, the same everywhere (#655). */
export const personalRatingRow = (ctx: Pick<QueryCtx, "db">, userId: Id<"users">, paperId: string) =>
  ctx.db.query("ratings").withIndex("by_user_and_collection_and_paper", (q) => q.eq("userId", userId).eq("collectionId", undefined).eq("paperId", ratedPaper(paperId))).unique();

/** Sets a person's own rating of a paper, or clears it with null. */
export async function setPersonalRating(ctx: MutationCtx, userId: Id<"users">, paperId: string, rating: number | null) {
  const row = await personalRatingRow(ctx, userId, paperId);
  if (rating === null) {
    if (row) await ctx.db.delete("ratings", row._id);
  } else if (!row) await ctx.db.insert("ratings", { userId, paperId: ratedPaper(paperId), rating });
  else if (row.rating !== rating) await ctx.db.patch("ratings", row._id, { rating });
}

/** How many of a purged person's ratings go per cleanup run. */
const PURGE_RATINGS = 200;

/** Deletes a step of a purged person's ratings, their own and in collections. Returns whether all are gone. */
export async function purgeRatings(ctx: MutationCtx, userId: Id<"users">) {
  const rows = await ctx.db.query("ratings").withIndex("by_user_and_collection_and_paper", (q) => q.eq("userId", userId)).take(PURGE_RATINGS);
  for (const row of rows) await ctx.db.delete("ratings", row._id);
  return rows.length < PURGE_RATINGS;
}
