import type { Infer } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { collectionCount, libraryCountRow } from "../library/counter";
import { taskPricing } from "../ai/serverModel";
import { screeningPaperCredits } from "../../lib/pricing";
import { createError } from "../lib/errors";
import type { paperSetValidator, screeningScoringConfigValidator } from "./validators";

/**
 * Refuses a screening whose rules include every paper, whatever it's answered: one with no
 * `minimumScore` (./scoring.ts reads none as every paper qualifying). The screening page always
 * sets one; a call that leaves it out is told so before the person is asked to pay for it.
 */
export function requireMinimum(config: Infer<typeof screeningScoringConfigValidator>) {
  if (config.minimumScore === undefined) {
    throw createError("VALIDATION_ERROR", "scoringConfig needs minimumScore, the least score a paper needs to be included: without it every paper is included whatever it's answered. With one question worth 1 point for yes, that's 1.");
  }
}

/**
 * What screening `papers` papers holds against an `available` balance at `perPaper` credits a
 * paper (lib/pricing/estimate.ts `screeningPaperCredits`), and how many papers that balance
 * covers: the hold a job takes when it starts. The Screen all dialog and the assistant's
 * approval card both show it.
 */
export function estimateScreening(papers: number, available: number, perPaper: number) {
  return {
    credits: Math.max(0, papers) * perPaper,
    available,
    affordablePapers: Math.floor(available / perPaper),
  };
}

/** What screening one paper costs a person at most, on the model their Screen all runs on. */
export async function screeningPaperCreditsFor(ctx: QueryCtx, userId: Id<"users">) {
  return screeningPaperCredits(await taskPricing(ctx, userId, "screenAll"));
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
export async function screeningHold(ctx: QueryCtx, userId: Id<"users">, { set, first, last, scoringConfig }: { set: Infer<typeof paperSetValidator>; first: number; last: number; scoringConfig: Infer<typeof screeningScoringConfigValidator> }) {
  requireMinimum(scoringConfig);
  const held = await papersIn(ctx, userId, set);
  return estimateScreening(Math.max(0, Math.min(last, held ?? last) - first + 1), 0, await screeningPaperCreditsFor(ctx, userId)).credits;
}
