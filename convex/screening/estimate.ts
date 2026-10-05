import type { Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { collectionCount, libraryCountRow } from "../library/counter";
import { ESTIMATED_CREDITS_PER_PAPER } from "../lib/constants";
import type { paperSetValidator } from "./validators";

/**
 * What screening `papers` papers holds against an `available` balance, and how many papers
 * that balance covers: the hold a job takes when it starts. The Screen all dialog and the
 * assistant's approval card both show it.
 */
export function estimateScreening(papers: number, available: number) {
  return {
    credits: Math.ceil(Math.max(0, papers) * ESTIMATED_CREDITS_PER_PAPER),
    available,
    affordablePapers: Math.floor(available / ESTIMATED_CREDITS_PER_PAPER),
  };
}

/**
 * How many papers a set holds, where the account keeps count: a collection, the library, a
 * screening's included papers. Null when it doesn't, or the set isn't the person's. A
 * search's papers are OpenAlex's to count: the figure its page last saw can be behind, and
 * is 0 on a search not counted yet, so it says nothing about what a job would read.
 */
export async function papersIn(ctx: QueryCtx, userId: Id<"users">, set: Infer<typeof paperSetValidator>): Promise<number | null> {
  if (set.kind === "collection") {
    const collection = await ctx.db.get("collections", set.collectionId);
    return collection?.userId === userId ? await collectionCount(ctx, collection) : null;
  }
  if (set.kind === "saved") return (await libraryCountRow(ctx, userId))?.count ?? null;
  if (set.kind === "screening") {
    const job = await ctx.db.get("screeningJobs", set.jobId);
    if (job?.userId !== userId) return null;
    return (await ctx.db.query("screeningJobProgress").withIndex("by_job", (q) => q.eq("jobId", set.jobId)).unique())?.qualified ?? null;
  }
  return null;
}

/**
 * The most screening papers `first` to `last` of a set holds: the estimate for every paper in
 * that range, up to how many the set is known to have. For a search that is the whole range
 * asked for. Papers a search's page already answered cost nothing, so it is an upper figure.
 */
export async function screeningHold(ctx: QueryCtx, userId: Id<"users">, { set, first, last }: { set: Infer<typeof paperSetValidator>; first: number; last: number }) {
  const held = await papersIn(ctx, userId, set);
  return estimateScreening(Math.max(0, Math.min(last, held ?? last) - first + 1), 0).credits;
}
